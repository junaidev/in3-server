/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-server
 * 
 * Copyright (C) 2018-2019 slock.it GmbH, Blockchains LLC
 * 
 * 
 * COMMERCIAL LICENSE USAGE
 * 
 * Licensees holding a valid commercial license may use this file in accordance 
 * with the commercial license agreement provided with the Software or, alternatively, 
 * in accordance with the terms contained in a written agreement between you and 
 * slock.it GmbH/Blockchains LLC. For licensing terms and conditions or further 
 * information please contact slock.it at in3@slock.it.
 * 	
 * Alternatively, this file may be used under the AGPL license as follows:
 *    
 * AGPL LICENSE USAGE
 * 
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free Software 
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *  
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY 
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A 
 * PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
 * [Permissions of this strong copyleft license are conditioned on making available 
 * complete source code of licensed works and modifications, which include larger 
 * works using a licensed work, under the same license. Copyright and license notices 
 * must be preserved. Contributors provide an express grant of patent rights.]
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 *******************************************************************************/



import { methodID } from 'ethereumjs-abi'
import { toBuffer, toChecksumAddress, privateToAddress } from 'ethereumjs-util'
import { Transport, AxiosTransport, util, transport } from 'in3-common'
import { RPCResponse } from '../types/types'
import * as ETx from 'ethereumjs-tx'
import { SentryError } from '../util/sentryError'
import { AbiCoder } from '@ethersproject/abi'
const BN = require('bn.js')

const toHex = util.toHex

let idCount = 1
export async function deployContract(url: string, bin: string, txargs?: {
  privateKey: string
  gas: number
  nonce?: number
  gasPrice?: number
  to?: string
  data?: string
  value?: number
  confirm?: boolean
}, transport?: Transport) {
  return sendTransaction(url, { value: 0, ...txargs, data: bin }, transport)
}

export async function callContract(url: string, contract: string, signature: string, args: any[], txargs?: {
  privateKey: string
  gas: number
  nonce?: number
  gasPrice?: number
  to?: string
  data?: string
  value: any
  confirm?: boolean
}, transport?: Transport) {
  if (!transport) transport = new AxiosTransport()
  const data = '0x' + encodeFunction(signature, args)

  if (txargs)
    return sendTransaction(url, { ...txargs, to: contract, data }, transport)

  return decodeFunction(signature.replace('()', '(uint)'), toBuffer(await transport.handle(url, {
    jsonrpc: '2.0',
    id: idCount++,
    method: 'eth_call', params: [{
      to: contract,
      data
    },
      'latest']
  }).then((_: RPCResponse) => _.error
    ? Promise.reject(new SentryError('Could not call contract', 'contract_call_error', 'Could not call ' + contract + ' with ' + signature + ' params=' + JSON.stringify(args) + ':' + _.error)) as any
    : _.result + ''
  )))
}


export async function sendTransaction(url: string, txargs: {
  privateKey: string
  gas: number
  nonce?: number
  gasPrice?: number
  to?: string
  data: string
  value: any
  confirm?: boolean
}, transport?: Transport): Promise<{
  blockHash: string,
  blockNumber: string,
  contractAddress: string,
  cumulativeGasUsed: string,
  gasUsed: string,
  logs: string[],
  logsBloom: string,
  root: string,
  status: string,
  transactionHash: string,
  transactionIndex: string
}> {

  if (!transport) transport = new AxiosTransport()
  const key = toBuffer(txargs.privateKey)
  const from = toChecksumAddress(privateToAddress(key).toString('hex'))

  // get the nonce
  if (!txargs.nonce)
    txargs.nonce = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_getTransactionCount',
      params: [from, 'latest']
    }).then((_: RPCResponse) => parseInt(_.result as any))

  // get the nonce
  if (!txargs.gasPrice)
    txargs.gasPrice = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_gasPrice',
      params: []
    }).then((_: RPCResponse) => parseInt(_.result as any))

  // create Transaction
  const tx = new ETx({
    nonce: toHex(txargs.nonce),
    gasPrice: toHex(txargs.gasPrice),
    gasLimit: toHex(txargs.gas),
    gas: toHex(txargs.gas),
    to: txargs.to ? toHex(txargs.to, 20) : undefined,
    value: toHex(txargs.value || 0),
    data: toHex(txargs.data)
  })
  tx.sign(key)


  const txHash = await transport.handle(url, {
    jsonrpc: '2.0',
    id: idCount++,
    method: 'eth_sendRawTransaction',
    params: [toHex(tx.serialize())]
  }).then((_: RPCResponse) => _.error ? Promise.reject(new SentryError('Error sending tx', 'tx_error', 'Error sending the tx ' + JSON.stringify(txargs) + ':' + JSON.stringify(_.error))) as any : _.result + '')

  return txargs.confirm ? waitForReceipt(url, txHash, 30, txargs.gas, transport) : txHash
}


export async function waitForReceipt(url: string, txHash: string, timeout = 10, sentGas = 0, transport?: Transport) {
  if (!transport) transport = new AxiosTransport()

  let steps = 200
  const start = Date.now()
  while (Date.now() - start < timeout * 1000) {
    const r = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_getTransactionReceipt',
      params: [txHash]
    }) as RPCResponse

    if (r.error) throw new SentryError('Error fetching receipt', 'error_fetching_tx', 'Error fetching the receipt for ' + txHash + ' : ' + JSON.stringify(r.error))
    if (r.result) {
      const receipt = r.result as any
      if (sentGas && parseInt(sentGas as any) === parseInt(receipt.gasUsed))
        throw new SentryError('Transaction failed and all gas was used up', 'gas_error', sentGas + ' not enough')
      if (receipt.status && receipt.status == '0x0')
        throw new SentryError('tx failed', 'tx_failed', 'The Transaction failed because it returned status=0')
      return receipt
    }

    // wait a second and try again
    await new Promise(_ => setTimeout(_, Math.min(timeout * 200, steps *= 2)))
  }

  throw new SentryError('Error waiting for the transaction to confirm')



}

function encodeEtheresBN(val: any) {
  return val && BN.isBN(val) ? toHex(val) : val
}

export function encodeFunction(signature: string, args: any[]): string {
  const inputParams = signature.split(':')[0]

  const abiCoder = new AbiCoder()

  const typeTemp = inputParams.substring(inputParams.indexOf('(') + 1, (inputParams.indexOf(')')))

  const typeArray = typeTemp.length > 0 ? typeTemp.split(",") : []
  const methodHash = (methodID(signature.substr(0, signature.indexOf('(')), typeArray)).toString('hex')

  return methodHash + abiCoder.encode(typeArray, args.map(encodeEtheresBN)).substr(2)

}

function fixBN(val: any) {
  if (val && val._isBigNumber) return new BN.BN(val.toHexString().substr(2), 'hex')
  if (Array.isArray(val)) return val.map(fixBN)
  return val
}

export function decodeFunction(signature: string | string[], args: Buffer): any {

  const outputParams = Array.isArray(signature) ? "(" + signature.toString() + ")" : signature.split(':')[1]

  const abiCoder = new AbiCoder()

  const typeTemp = outputParams.substring(outputParams.indexOf('(') + 1, (outputParams.indexOf(')')))

  const typeArray = typeTemp.length > 0 ? typeTemp.split(",") : []

  return fixBN(abiCoder.decode(typeArray, args))
}
