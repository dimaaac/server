import { GAMERULES, version, MOD, OP, stat } from '../config.js'
import { players } from '../world/index.js'
import { Dimensions } from '../world/index.js'
import { chat, LIGHT_GREY, ITALIC, prefix } from './chat.js'
import { Entities, Entity, entityMap } from '../entities/entity.js'
import { optimize, stats } from '../internals.js'
import { Item, Items } from '../items/item.js'
import { goto, jump, place, right } from './ant.js'
import { Blocks } from '../blocks/block.js'
import { current_tps, setTPS } from '../world/tick.js'
import { started } from '../server.js'


const ID = /[a-zA-Z0-9_]*/y, NUM = /[+-]?(\d+(\.\d*)?|\.\d+)([Ee][+-]?\d+)?/y, BOOL = /1|0|true|false|/yi, STRING = /(['"`])((?!\1|\\).|\\.)*\1/y
const ESCAPES = {n: '\n', b: '\b', t: '\t', v: '\v', r: '\r', f: '\f'}
function snbt(s, i, t, T1, T2){
	if(typeof t == 'object'){
		if(s[i] != '{') throw 'Expected dict literal'
		while(s[++i] == ' ');
		if(s[i] == '}') return
		while(true){
			ID.lastIndex = i
			const [k] = s.match(ID)
			if(!k.length) throw 'expected prop name in dict declaration'
			i = ID.lastIndex - 1
			while(s[++i] == ' ');
			if(s[i] != ':' && s[i] != '=') throw 'expected : or = after prop name in snbt'
			while(s[++i] == ' ');
			const T = T2[k] || T1[k]
			switch(T){
				case Int8: case Int16: case Int32: case Float32:
				case Uint8: case Uint16: case Uint32: case Float64:
				if((s[i] < '0' || s[i] > '9') && s[i] != '.' && s[i] != '-' && s[i] != '+') throw 'Expected number for key '+k
				NUM.lastIndex = i
				t[k] = T(+s.match(NUM)[0])
				i = NUM.lastIndex
				break
				case Boolean:
				BOOL.lastIndex = i
				switch(s.match(BOOL)[0][0]){
					case 't': case 'T': case '1':	t[k] = true; break
					case 'f': case 'F': case '0': t[k] = false; break
					default: throw 'Expected boolean for key '+k
				}
				i = BOOL.lastIndex
				case String:
				STRING.lastIndex = i
				const a = s.match(STRING)
				if(!a) throw 'Expected string for key '+k
				t[k] = a.slice(1,-1).replace(/\\(x[a-fA-F0-9]{2}|u[a-fA-F0-9]{4}|.)/g, v => v.length > 2 ? String.fromCharCode(parseInt(v.slice(2))) : ESCAPES[v[1]] || v[1])
				break
				case undefined: case null: throw 'Object does not have key '+k
				default: i = snbt(s, i, t[k])
			}
			i--
			while(s[++i] == ' ');
			if(i >= s.length || s[i] == '}') break
			else if(s[i] != ',' && s[i] != ';') throw 'expected , or ; after prop declaration in snbt'
			while(s[++i] == ' ');
		}
	}else if(Array.isArray(t)){
		if(s[i] != '[') throw 'Expected array literal'
		while(s[++i] == ' ');
		let [T, l = NaN] = T1 || T2
		if(s[i] == ']' && !l) return void(t.length=0);
		let j = -1
		while(true){
			if(++j == l) throw 'Too many elements in array literal'
			switch(T){
				case Int8: case Int16: case Int32: case Float32:
				case Uint8: case Uint16: case Uint32: case Float64:
				if((s[i] < '0' || s[i] > '9') && s[i] != '.' && s[i] != '-' && s[i] != '+') throw 'Expected number for key '+k
				NUM.lastIndex = i
				t[j] = T(+s.match(NUM)[0])
				i = NUM.lastIndex
				break
				case Boolean:
				BOOL.lastIndex = i
				switch(s.match(BOOL)[0][0]){
					case 't': case 'T': case '1':	t[j] = true; break
					case 'f': case 'F': case '0': t[j] = false; break
					default: throw 'Expected boolean for key '+k
				}
				i = BOOL.lastIndex
				case String:
				STRING.lastIndex = i
				const a = s.match(STRING)
				if(!a) throw 'Expected string for key '+k
				t[j] = a.slice(1,-1).replace(/\\(x[a-fA-F0-9]{2}|u[a-fA-F0-9]{4}|.)/g, v => v.length > 2 ? String.fromCharCode(parseInt(v.slice(2))) : ESCAPES[v[1]] || v[1])
				break
				case undefined: case null: throw 'Invalid array type (weird)'
				default: i = snbt(s, i, t[j])
			}
			if(j < l) throw 'Not enough elements in array literal'
			i--
			while(s[++i] == ' ');
			if(i >= s.length || s[i] == '}') break
			else if(s[i] != ',' && s[i] != ';') throw 'expected , or ; after prop declaration in snbt'
			while(s[++i] == ' ');
		}
	}
}

function parseCoords(x, y, d, t){
	let w = typeof d == 'string' ? Dimensions[d] : d
	if(!w) throw 'No such dimension'
	if(x[0] == "^" && y[0] == "^"){
		x = (+x.slice(1))/180*PI - t.facing
		y = +y.slice(1);
		[x, y] = [t.x + sin(x) * y, t.y + cos(x) * y]
	}else{
		if(x[0] == "~")x = t.x + +x.slice(1)
		else x -= 0
		if(y[0] == "~")y = t.y + +y.slice(1)
		else y -= 0
	}
	if(x != x || y != y) throw 'Invalid coordinates'
	return {x, y, w}
}

function log(who, msg){
	if(!GAMERULES.commandlogs)return
	chat(prefix(who, 1) + msg, LIGHT_GREY + ITALIC, who)
}

function selector(a, who){
	if(!a)throw 'Selector missing!'
	if(a[0] == '@'){
		if(a[1] == 's')return who instanceof Entity ? [who] : []
		if(a[1] == 'e')return [...entityMap.values()]
		if(a[1] == 'n'){
			if(!who || !entityMap.delete(who._id))return [...entityMap.values()]
			const a = [...entityMap.values()]
			entityMap.set(who._id, who)
			return a
		}
		const candidates = [...players.values()]
		if(!candidates.length)throw "No targets matched selector"
		if(a[1] == 'a')return candidates
		if(a[1] == 'p'){
			if(!who || who.clients)throw "No targets matched selector"
			const closest = candidates.winner(a => {
				if(a.world != who.world)return -Infinity
				const dx = a.x - who.x, dy = a.y - who.y
				return -(dx * dx + dy * dy)
			})
			return [closest]
		}
		if(a[1] == 'r')return [candidates[floor(random() * candidates.length)]]
	}else{
		const player = players.get(a)
		if(!player)throw "No targets matched selector"
		return [player]
	}
	throw 'Invalid selector'
}

let stack = null
export function err(e){
	if(!e.stack)return e
	stack = e.stack
	return e + '\nType /stacktrace to view full stack trace'
}

const ENTITYCOMMONDATA = {dx: Float, dy: Float, f: Float, age: Double}

export const commands = {
	list(){
		let a = "Online players"
		for(let pl of players.values())a += '\n' + pl.name + ' ('+pl.health+')'
		return a
	},
	say(s, ...l){
		if(!l.length)throw 'Command usage: /say <style> <text...>\nExample: /say lime-bold Hello!'
		let col = 0, txt = s.includes('raw') ? l.join(' ') : prefix(this, 1) + l.join(' ')
		for(let [m] of (s.match(/bold|italic|underline|strike/g)||[]))col |= (m > 'i' ? m == 'u' ? 64 : 128 : m == 'b' ? 16 : 32)
		col += s.match(/()black|()dark[-_]?red|()dark[-_]?green|()(?:gold|dark[-_]?yellow)|()dark[-_]?blue|()dark[-_]?purple|()dark[-_]?(?:aqua|cyan)|()(?:light[-_]?)?gr[ea]y|()dark[-_]?gr[ea]y|()red|()(?:green|lime)|()yellow|()blue|()purple|()(?:aqua|cyan)|$/).slice(1).indexOf('') & 15
		chat(txt, col)
	},
	tpe(a, b){
		if(!b)b = a, a = '@s'
		const players = selector(a, this)
		const [target, _] = selector(b, this)
		if(_ || !target)throw 'Selector must return exactly 1 target'
		const {x, y, world} = target
		for(const pl of players)pl.transport(x, y, world), pl.rubber()
		if(players.length>1)log(this, `Teleported ${players.length} entities to ${target.name}`)
		else log(this, `Teleported ${players[0].name} to ${target.name}`)
	},
	tp(a, _x, _y, d = this.world || 'overworld'){
		if(!_y)_y=_x,_x=a,a='@s'
		const players = selector(a, this)
    const {x, y, w} = parseCoords(_x, _y, d, this)
		if(x != x || y != y)throw 'Invalid coordinates'
		for(const pl of players)pl.transport(x, y, w), pl.rubber()
		if(players.length>1)log(this, `Teleported ${players.length} entities to (${x}, ${y}) in the ${w.id}`)
		else log(this, `Teleported ${players[0].name} to (${x}, ${y}) in the ${w.id}`)
	},
	kick(a, ...r){
		const reason = r.join(' ')
		let players = selector(a, this)
		if(players.length > 1 && this.sock.permissions < OP)throw 'Moderators may not kick more than 1 person at a time'
		stat('misc', 'player_kicks', players.length)
		for(const pl of players){
			pl.sock.send(reason ? '-12fYou were kicked for: \n'+reason : '-12fYou were kicked')
			pl.sock.close()
		}
	},
	give(sel, item, count = '1'){
		let itm = Items[item], c = max(count | 0, 0)
		if(!itm)throw 'No such item: '+item
		for(const player of selector(sel, this)){
			const stack = itm(c)
			player.give(stack)
			if(stack.count){
				const e = Entities.item(player.x, player.y)
				e.x = player.x; e.y = player.y; e.place(player.world)
			}
		}
	},
	summon(type, _x = '~', _y = '~', data = '{}', d = this.world || 'overworld'){
		const {x, y, w} = parseCoords(_x, _y, d, this)
		if(!(type in Entities))throw 'No such entity: ' + type
		const e = Entities[type](x, y)
		snbt(data, 0, e, e.savedata, ENTITYCOMMONDATA)
		e.place(w)
	},
	mutate(sel, data){
		let i = 0
		for(const e of selector(sel, this)){
			i++
			snbt(data, 0, e, e.savedata, ENTITYCOMMONDATA)
			if(e.rubber) e.rubber()
		}
		return 'Successfully mutated '+i+' entities'
	},
	setblock(_x = '~', _y = '~', type, data = '{}', d = this.world || 'overworld'){
		const {x, y, w} = parseCoords(_x, _y, d, this)
		if(!(type in Blocks))throw 'No such block: ' + type
		const b = Blocks[type]()
		snbt(data, 0, b, b.savedata)
		goto(floor(x), floor(y), w)
		place(b)
		return 'Set block at ('+ifloat(x)+', '+ifloat(y)+')'
	},
	fill(_x, _y, _x2, _y2, type, d = this.world || 'overworld'){
		let n = performance.now()
		let {x, y, w} = parseCoords(_x, _y, d, this)
		let {x: x2, y: y2} = parseCoords(_x2, _y2, d, this)
		x2=floor(x2-(x=floor(x)|0))|0;y2=floor(y2-(y=floor(y)|0))|0; goto(x, y, w)
		if(x2 < 0 || y2 < 0)return;
		if(!(type in Blocks))throw 'No such block: ' + type
		const b = Blocks[type]
		for(y = 0; y != y2+1; y=(y+1)|0){
			for(x = 0; x != x2+1; x=(x+1)|0){
				place(b)
				right()
			}
			jump(-x2-1,1)
		}
		n = performance.now() - n
		const count = x2*y2+x2+y2+1
		return 'Filled '+count+' blocks' + (count > 10000 ? ' in '+n.toFixed(1)+' ms' : '')
	},
	clear(sel, _item, _max = '2147483647'){
		const Con = _item && Items[_item]?.constructor || Item
		let cleared = 0, es = 0
		for(const e of selector(sel, this)){
			let max = +_max
			const changed = []
			if(e.inv) for(let i = 0; max && i < e.inv.length; i++){
				const item = e.inv[i]
				if(!item || !(item instanceof Con)) continue
				changed.push(i)
				if(item.count <= max)max -= item.count, e.inv[i] = null
				else item.count -= max, max = 0
			}
			if(e.items) for(let i = 0; max && i < e.items.length; i++){
				const item = e.items[i]
				if(!item || !(item instanceof Con)) continue
				changed.push(i | 128)
				if(item.count <= max)max -= item.count, e.items[i] = null
				else item.count -= max, max = 0
			}
			cleared += +_max - max; es++
			e.itemschanged(changed)
		}
		log(this, `Cleared a total of ${cleared} items from ${es} entities`)
	},
	help(c){
		const cmds = this.sock.permissions == MOD ? mod_help : this.sock.permissions == OP ? help : anyone_help
		if(!c){
			return 'Commands: /'+Object.keys(cmds).join(', /')+'\n/help '+cmds.help
		}else if(c in cmds){
			return Array.isArray(cmds[c]) ? cmds[c].map(a => '/' + c + ' ' + a).join('\n') : '/' + c + ' ' + cmds[c]
		}else{
			return 'No such command: /'+c
		}
	},
	stacktrace(){
		if(!stack)return 'No stack trace found...'
		console.warn(stack)
		return stack
	},
	time(time, d = this.world || 'overworld'){
		if(typeof d == 'string')d = Dimensions[d]
		if(!d) throw 'Invalid dimension'
		if(!time){
			return `This dimension is on tick ${d.tick}\nThe day is ${floor((d.tick + 7000) / 24000)} and the time is ${floor((d.tick/1000+6)%24).toString().padStart(2,'0')}:${(floor((d.tick/250)%4)*15).toString().padStart(2,'0')}`
		}else if(time[0] == '+' || time[0] == '-'){
			let t = d.tick + +time
			if(t < 0)t = (t % 24000 + 24000) % 24000
			if(t != t)throw `'${time}' is not a valid number`
			d.tick = t
			return 'Set the time to '+t
		}else if(time[0] >= '0' && time[0] <= '9'){
			const t = +time
			if(!(t >= 0))throw `'${time}' is not a valid number`
			d.tick = t
			return 'Set the time to '+t
		}
		let t;
		switch(time){
			case 'day': t = 1800; break
			case 'noon': t = 6000; break
			case 'afternoon': t = 9000; break
			case 'sunset': t = 13800; break
			case 'night': t = 15600; break
			case 'midnight': t = 18000; break
			case 'dark': t = 22000; break
			case 'sunrise': t = 0; break
			default:
			throw "'invalid option: '"+time+"'"
		}
		t = (d.tick - t) % 24000
		if(t >= 12000)d.tick += (24000 - t)
		else d.tick -= t
		return 'Set the time to '+time
	},
	gamerule(a, b){
		if(!a){
			return 'List of gamerules:\n' + Object.entries(GAMERULES).map(([k, v]) => k + ': ' + typeof v).join('\n')
		}
		if(!b){
			if(!(a in GAMERULES)) throw 'No such gamerule: ' + a
			return 'Gamerule ' + a + ': ' + JSON.stringify(GAMERULES[a])
		}
		switch(typeof GAMERULES[a]){
			case 'boolean': if(b.toLowerCase() == 'true' || b == '1') GAMERULES[a] = true; else if(b.toLowerCase() == 'false' || b == '0') GAMERULES[a] = false; else throw 'Invalid boolean value: ' + b; break
			case 'number': const c = +b; if(c == c) GAMERULES[a] = c; else throw 'Invalid number value: ' + b; break
			case 'string': GAMERULES[a] = c; break
			default: throw 'No such gamerule: ' + a
		}
		return 'Set gamerule ' + a + ' to ' + JSON.stringify(GAMERULES[a])
	},
	spawnpoint(x='~',y='~',d=this.world||'overworld'){
		if(x.toLowerCase() == 'tp') // For the /spawnpoint tp [entity] syntax
			return commands.tp.call(this, y || '@s', GAMERULES.spawnX, GAMERULES.spawnY, GAMERULES.spawnWorld)
		void ({x: GAMERULES.spawnX, y: GAMERULES.spawnY, w: {id: GAMERULES.spawnWorld}} = parseCoords(x,y,d,this))
		return 'Set the spawn point successfully!'
	},
	info(){
		return `Vanilla server software ${version}\nUptime: ${Date.formatTime(Date.now() - started)}, CPU: ${(stats.elu.cpu1*100).toFixed(1)}%, RAM: ${(stats.mem.cpu1/1048576).toFixed(1)}MB` + (this.age ? '\nYou have been in this server for: ' + Date.formatTime(this.age * 1000 / current_tps) : '')
	},
	tps(tps){
		setTPS(max(1, min((tps|0) || 20, 1000)))
		for(const pl of players.values()){
			let buf = new DataWriter()
			buf.byte(1)
			buf.int(pl._id | 0)
			buf.short(pl._id / 4294967296 | 0)
			buf.byte(pl.sock.r)
			buf.float(current_tps)
			pl.sock.packets.push(buf)
		}
		return 'Set the TPS to '+current_tps
	},
	kill(t, cause = 'void'){
		let i = 0
		for(const e of selector(t, this)){
			if(cause != 'void') e.died()
			e.remove()
			i++
		}
		return 'Killed '+i+' entities'
	}
}

//Aliases
commands.i = commands.info

export const anyone_help = {
	help: '<cmd> -- Help for a command',
	list: '-- List online players',
	info: '-- Info about the server and yourself'
}, mod_help = {
	...anyone_help,
	kick: '[player] -- Kick a player',
	say: '[style] [msg] -- Send a message in chat',
	tp: '[targets] [x] [y] (dimension) -- teleport someone to a dimension',
	tpe: '[targets] [destEntity]',
	time: ['+[amount] -- Add to time', '-[amount] -- Substract from time', '[value] -- Set time', '-- Get current time'],
	summon: '[entity_type] (x) (y) (snbt_data) (dimension) -- Summon an entity',
	setblock: '[x0] [y0] [x1] [y1] [block_type] (dimension) -- Place a block somewhere',
	clear: '[player] (filter_item) (max_amount) -- Remove items from a player'
}, help = {
	...mod_help,
	fill: '[x0] [y0] [x1] [y1] [block_type] (dimension) -- Fill an area with a certain block',
	mutate: '[entity] [snbt_data] -- Change properties of an entity',
	gamerule: '[gamerule] [value] -- Change a gamerule, such as difficulty or default gamemode',
	tps: '[tps] -- Set server-side tps',
	spawnpoint: ['(x) (y) (dimension) -- Set the spawn point', 'tp (who) -- Teleport entities to spawn'],
}
Object.setPrototypeOf(anyone_help, null)
Object.setPrototypeOf(mod_help, null)
Object.setPrototypeOf(help, null)
optimize(parseCoords, snbt, ...Object.values(commands))