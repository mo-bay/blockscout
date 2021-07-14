import $ from 'jquery'
import omit from 'lodash/omit'
import URI from 'urijs'
import humps from 'humps'
import { subscribeChannel } from '../../socket'
import { connectElements } from '../../lib/redux_helpers.js'
import { createAsyncLoadStore } from '../../lib/async_listing_load'
import { batchChannel } from '../lib/utils'
import '../address'
import { isFiltered } from './utils'

const BATCH_THRESHOLD = 6

export const initialState = {
  addressHash: null,
  channelDisconnected: false,
  filter: null
}

export function reducer (state, action) {
  switch (action.type) {
    case 'PAGE_LOAD':
    case 'ELEMENTS_LOAD': {
      return Object.assign({}, state, omit(action, 'type'))
    }
    case 'CHANNEL_DISCONNECTED': {
      if (state.beyondPageOne) return state

      return Object.assign({}, state, { channelDisconnected: true })
    }
    case 'RECEIVED_NEW_TRANSACTION': {
      if (state.channelDisconnected) return state

      /*if (state.beyondPageOne ||
        (state.filter === 'to' && action.msgs.toAddressHash !== state.addressHash) ||
        (state.filter === 'from' && action.msgs.fromAddressHash !== state.addressHash)) {
          return state
      }*/

      const transactionCount = state.transactionCount + action.msgs.length

      if (state.transactionsLoading || state.transactionsError) {
        return Object.assign({}, state, { transactionCount })
      }

      const transactionsLength = state.transactions.length + action.msgs.length
      if (transactionsLength < BATCH_THRESHOLD) {
        return Object.assign({}, state, {
          transactions: [
            ...action.msgs.reverse(),
            ...state.transactions
          ],
          transactionCount
        })
      } else if (!state.transactionsBatch.length && action.msgs.length < BATCH_THRESHOLD) {
        return Object.assign({}, state, {
          transactions: [
            ...action.msgs.reverse(),
            ...state.transactions.slice(0, -1 * action.msgs.length)
          ],
          transactionCount
        })
      } else {
        return Object.assign({}, state, {
          transactionsBatch: [
            ...action.msgs.reverse(),
            ...state.transactionsBatch
          ],
          transactionCount
        })
      }


     // return Object.assign({}, state, { items: [action.msg.transactionHtml, ...state.items] })
    }
    case 'RECEIVED_NEW_REWARD': {
      if (state.channelDisconnected) return state

      return Object.assign({}, state, { items: [action.msg.rewardHtml, ...state.items] })
    }
    default:
      return state
  }
}

const elements = {
  '[data-selector="channel-disconnected-message"]': {
    render ($el, state) {
      if (state.channelDisconnected) $el.show()
    }
  },
  '[data-test="filter_dropdown"]': {
    render ($el, state) {
      if (state.emptyResponse && !state.isSearch) {
        if (isFiltered(state.filter)) {
          $el.addClass('no-rm')
        } else {
          return $el.hide()
        }
      } else {
        $el.removeClass('no-rm')
      }

      return $el.show()
    }
  },
  '[data-selector="channel-batching-count"]': {
    render ($el, state, _oldState) {
      const $channelBatching = $('[data-selector="channel-batching-message"]')
      if (!state.transactionsBatch.length) return $channelBatching.hide()
      $channelBatching.show()
      $el[0].innerHTML = numeral(state.transactionsBatch.length).format()
    }
  }
}

if ($('[data-page="address-transactions"]').length) {
  const store = createAsyncLoadStore(reducer, initialState, 'dataset.identifierHash')
  const addressHash = $('[data-page="address-details"]')[0].dataset.pageAddressHash
  const { filter, blockNumber } = humps.camelizeKeys(URI(window.location).query(true))

  connectElements({ store, elements })

  store.dispatch({
    type: 'PAGE_LOAD',
    addressHash,
    filter,
    beyondPageOne: !!blockNumber
  })

  const addressChannel = subscribeChannel(`addresses:${addressHash}`)
  addressChannel.onError(() => store.dispatch({ type: 'CHANNEL_DISCONNECTED' }))
  addressChannel.on('transaction', batchChannel((msgs) => 
    store.dispatch({
      type: 'RECEIVED_NEW_TRANSACTION',
      msgs: humps.camelizeKeys(msgs)
    })
  ))
  addressChannel.on('pending_transaction', batchChannel((msgs) => 
    store.dispatch({
      type: 'RECEIVED_NEW_TRANSACTION',
      msgs: humps.camelizeKeys(msgs)
    })
  ))

  const rewardsChannel = subscribeChannel(`rewards:${addressHash}`)
  rewardsChannel.onError(() => store.dispatch({ type: 'CHANNEL_DISCONNECTED' }))
  rewardsChannel.on('new_reward', (msg) => {
    store.dispatch({
      type: 'RECEIVED_NEW_REWARD',
      msg: humps.camelizeKeys(msg)
    })
  })

  const $txReloadButton = $('[data-selector="reload-transactions-button"]')
  const $channelBatching = $('[data-selector="channel-batching-message"]')
  $txReloadButton.on('click', (event) => {
    event.preventDefault()
    loadTransactions(store)
    $channelBatching.hide()
    store.dispatch({
      type: 'TRANSACTION_BATCH_EXPANDED'
    })
  })
}
