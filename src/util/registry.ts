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


import * as tx from './tx'
import { toChecksumAddress } from 'ethereumjs-util'
import { Transport, util } from 'in3-common'
import { readFileSync } from 'fs'
import { padStart } from 'in3-common/js/src/util/util';
import { padEnd } from 'in3-common/js/src/util/util';
const toHex = util.toHex

const bin = JSON.parse(readFileSync('./contracts/contracts.json', 'utf8'))

const in3ContractBin = JSON.parse(readFileSync('node_modules/in3-contracts/contracts/contracts.json', 'utf8'))
try {
  const binTest = JSON.parse(readFileSync('./test/contracts/contracts.json', 'utf8'))
  Object.assign(bin.contracts, binTest.contracts)
} catch (x) {
  // it's ok, if the test contracts are missing
}

export function getABI(name: string) {
  return JSON.parse(in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf(name) >= 0)].abi)
}

export function deployContract(name: string, pk: string, url = 'http://localhost:8545', transport?: Transport) {
  return tx.deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf(name) >= 0)].bin, {
    privateKey: pk,
    gas: 3000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)

}

export function deployChainRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport) {
  return tx.deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf('ChainRegistry') >= 0)].bin, {
    privateKey: pk,
    gas: 3000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)

}

export async function deployNodeRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport) {

  const blockHashAddress = (await deployBlockhashRegistry(pk, url, transport)).substr(2)
  return tx.deployContract(url, '0x' + in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf('/contracts/NodeRegistry.sol:NodeRegistry') >= 0)].bin + padStart(blockHashAddress, 64, "0"), {
    privateKey: pk,
    gas: 8000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)
}

export function deployBlockhashRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport) {
  return tx.deployContract(url, '0x' + in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf('/contracts/BlockhashRegistry.sol:BlockhashRegistry') >= 0)].bin, {
    privateKey: pk,
    gas: 8000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)
}

export async function registerNodes(pk: string, registry: string, data: {
  url: string,
  pk: string
  props: string
  deposit: any
  timeout: number
  weight?: number
}[], chainId: string, chainRegistry?: string, url = 'http://localhost:8545', transport?: Transport, registerChain = true) {
  if (!registry)
    registry = await deployNodeRegistry(pk, url, transport)

  for (const c of data)
    await tx.callContract(url, registry, 'registerNode(string,uint64,uint64,uint64)', [
      c.url,
      toHex(c.props, 32),
      c.timeout,
      c.weight ? c.weight : 0
    ], {
      privateKey: c.pk,
      gas: 3000000,
      confirm: true,
      value: c.deposit
    }, transport)

  if (registerChain)
    chainRegistry = await registerChains(pk, chainRegistry, [{
      chainId,
      bootNodes: data.map(c => util.getAddress(c.pk) + ':' + c.url),
      meta: 'dummy',
      registryContract: registry,
      contractChain: chainId
    }], url, transport)

  const regId = toHex((await tx.callContract(url, registry, "registryId():(bytes32)", []))[0])

  return {
    chainRegistry,
    chainId,
    registry,
    regId
  }


}

export async function registerChains(pk: string, chainRegistry: string, data: {
  chainId: string,
  bootNodes: string[],
  meta: string,
  registryContract: string,
  contractChain: string
}[], url = 'http://localhost:8545', transport?: Transport) {
  if (!chainRegistry)
    chainRegistry = await deployChainRegistry(pk, url, transport)

  for (const c of data) {
    //   const regId = await tx.callContract(url, c.registryContract, "registryId():(bytes32)", [])

    const registerTx = await tx.callContract(url, chainRegistry, 'registerChain(bytes32,string,string,address,bytes32)', [
      toHex(c.chainId, 32),
      c.bootNodes.join(','),
      c.meta,
      c.registryContract,
      //   regId,
      toHex(c.contractChain, 32)
    ], {
      privateKey: pk,
      gas: 3000000,
      confirm: true,
      value: 0
    }, transport)
  }


  return chainRegistry
}