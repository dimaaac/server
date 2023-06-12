import { World } from './world.js'
import '../internals.js'
import { fs } from '../internals.js'
export const Dimensions = {
	overworld: new World('overworld'),
	nether: new World('nether'),
	end: new World('end'),
	void: new World('void')
}
Object.setPrototypeOf(Dimensions, null)
const dimCreate = []
for(let i in Dimensions){
	let d = Dimensions[i]
	dimCreate.push(fs.readFile(WORLD + 'dimensions/' + d.id + '/meta').then(a => {
		const buf = new DataReader(a)
		return buf.read(d.constructor.savedatahistory[buf.flint()] || d.constructor.savedata, d)
	}).catch(e => null))
	dimCreate.push(fs.exists(WORLD + 'dimensions/' + d.id).then(a => a || fs.mkdir(WORLD + 'dimensions/' + d.id)))
}
await Promise.all(dimCreate)
export const allDimensions = Object.values(Dimensions)

export const players = new Map()
players[Symbol.for('nodejs.util.inspect.custom')] = function(){
	let a = '\x1b[32m' + this.size + '\x1b[m player'+(this.size==1?'':'s')+':'
	for(let pl of this){
		a += '\n' + pl[1]
	}
	return a
}