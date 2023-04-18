//import all block files
import { fs } from '../internals.js'
import { jsonToType, typeToJson } from '../utils/data.js'
import { BlockIDs, Blocks, Block } from './block.js'
// Monstrosity for importing all ./*/*.js
await Promise.all((await fs.readdir(PATH + 'blocks/', {withFileTypes: true})).filter(a=>a.isDirectory()).map(({name}) => fs.readdir(PATH + 'blocks/' + name).then(a => Promise.all(a.map(file => import(PATH + 'blocks/' + name + '/' + file))))))
let modified = false
export let blockindex
for(const a of await fs.readFile(WORLD + 'defs/blockindex.txt').then(a=>(blockindex = a+'').split('\n'))){
	let [name, ...history] = a.split(' ')
	const B = Blocks[name]
	if(!B){BlockIDs.push(Blocks.air);continue}
	let sd = typeToJson(B.savedata)
	if(history[history.length-1] == sd){history.pop()}else if(sd != 'null'){modified = true}
	B.savedatahistory = history.mutmap(jsonToType)
	if(Object.hasOwn(B, 'id'))
		if(B.className != name) Blocks[name] = class extends B{static id = BlockIDs.length; static className = name}
		else Object.hasOwn(B, 'otherIds') ? B.otherIds.push(BlockIDs.length) : B.otherIds = [BlockIDs.length]
	else B.id = BlockIDs.length, B.className = name
	BlockIDs.push(null)
}

for(const i in Blocks){
	const B = Blocks[i]
	// Force extend
	if(!(B.prototype instanceof Block)){
		console.warn('Class ' + i + ' does not extend Block\n')
		Object.setPrototypeOf(B, Block)
		Object.setPrototypeOf(B.prototype, Block.prototype)
	}
	if(!Object.hasOwn(B, 'id'))
		B.id = BlockIDs.length, B.savedatahistory = [], BlockIDs.push(null), B.className = i, modified = true
	const shared = new B
	B.constructor = BlockIDs[B.id] = Blocks[i] = B.savedata ? () => new B : Function.returns(shared)
	if(B.otherIds) for(const i of B.otherIds) BlockIDs[i] = BlockIDs[B.id]
	// Copy static props to prototype
	// This will also copy .prototype, which we want
	let proto = B
	while(proto.prototype && !Object.hasOwn(proto.prototype, 'prototype')){
		const desc = Object.getOwnPropertyDescriptors(proto)
		delete desc.length; delete desc.name
		Object.defineProperties(proto.prototype, desc)
		proto = Object.getPrototypeOf(proto)
	}	
	Object.setPrototypeOf(Blocks[i], B.prototype)
	Object.defineProperties(Blocks[i], Object.getOwnPropertyDescriptors(shared))
}
if(modified){
	await fs.writeFile(WORLD + 'defs/blockindex.txt', blockindex = BlockIDs.map(def => def.className + def.savedatahistory.map(a=>' '+typeToJson(a)).join('') + (def.savedata ? ' ' + typeToJson(def.savedata) : '')).join('\n'))
}

progress(`${BlockIDs.length} Blocks loaded`)