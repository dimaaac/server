import { Dimensions, players, PERMISSIONS, GAMERULES, stat } from '../world/index.js'
import { chat, YELLOW } from './chat.js'
import { DataReader, DataWriter } from '../modules/dataproto.js'
import { playerLeft, playerLeftQueue, queue } from './queue.js'
/*import { entityindex } from '../entities/index.js'
import { itemindex } from '../items/index.js'
import { blockindex } from '../blocks/index.js'
import { index } from './miscdefs.js'*/
import { Entities, EntityIDs } from '../entities/entity.js'
import { Items } from '../items/item.js'
import { actualTPS, currentTPS } from '../world/tick.js'

function sendTabMenu(encodePlayers = false){
	const buf = new DataWriter()
	buf.byte(4)
	buf.string('1fYou are playing on '+host)
	buf.string(`2${actualTPS>=currentTPS*0.8?'a':actualTPS>=currentTPS/2?'b':'9'}TPS: ${actualTPS.toFixed(2)}`)
	if(encodePlayers){
		buf.flint(players.size)
		for(const pl of players.values()){
			buf.string(pl.name)
			if(pl.skin){
				for(let i = 396; i < 1068; i += 84)
					buf.uint8array(new Uint8Array(pl.skin.buffer, pl.skin.byteOffset + i, 24), 24)
			}else for(let i = 0; i < 24; i++) buf.double(0)
			buf.byte(pl.health)
			buf.short(Math.min(65535, pl.sock.pingTime))
		}
	}
	const b = buf.build()
	for(const pl of players.values()) pl.sock.send(b)
}

setInterval(sendTabMenu, 2000)

const playersLevel = DB.sublevel('players', {valueEncoding: 'binary'})
const playersConnecting = new Set

export async function open(){
	this.state = 1
	if(playersConnecting.has(this.username)){
		this.send('-119You are still logging in/out from another session')
		this.close()
		throw 'Connect / disconnect shamble'
	}
	if(CONFIG.maxplayers && players.size + playersConnecting.size >= CONFIG.maxplayers){
		this.state = 2
		if(await queue(this)) return this.state && this.close()
		if(!this.state) return
		this.state = 1
	}
	playersConnecting.add(this.username)
	let permissions = PERMISSIONS[this.username] ?? PERMISSIONS['']
	if(permissions*1000 > Date.now()){
		this.send(permissions == 2147483647 ? '-119You are permanently banned from this server':'-119You are banned from this server for '
			+ Date.formatTime(permissions*1000-Date.now())+(CONFIG.ban_appeal_info?'\nBan appeal: '+CONFIG.ban_appeal_info:''))
		this.close()
		return
	}else if(permissions == 0){
		this.send('-11fYou are not invited to play on this server')
		this.close()
		return
	}else if(permissions > 9){ permissions = 2 }
	let player, dim, x, y
	let other = players.get(this.username)
	if(other){
		other.sock.send('-119You are logged in from another session')
		other.sock.entity = null
		other.sock.close()
		other.sock = null
		player = other
		playersConnecting.delete(this.username)
	}else try{
		const buf = new DataReader(await playersLevel.get(this.username))
		playersConnecting.delete(this.username)
		if(!this.state) return
		player = EntityIDs[buf.short()]()
		x = buf.double(); y = buf.double()
		dim = Dimensions[buf.string()]
		player._state = player.state = buf.short()
		player._dx = player.dx = buf.float(); player.dy = player.dy = buf.float()
		player.f = player.f = buf.float(); player.age = buf.double()
		buf.read(player.savedatahistory[buf.flint()] || player.savedata, player)
		other = null
	}catch(e){
		player = Entities.player()
		x = GAMERULES.spawnx; y = GAMERULES.spawny
		dim = Dimensions[GAMERULES.spawnworld]
		player.inv[0] = Items.stone(20)
		player.inv[1] = Items.oak_log(20)
		player.inv[2] = Items.oak_planks(20)
		player.inv[3] = Items.tnt(10)
		player.inv[4] = Items.flint_and_steel()
		player.inv[5] = Items.obsidian(64)
		player.inv[6] = Items.grass(32)
		player.inv[7] = Items.diamond_pickaxe()
		player.inv[8] = Items.diamond_shovel()
		player.inv[9] = Items.netherrack(10)
		player.inv[10] = Items.sandstone(10)
		stat('misc', 'unique_players')
		playersConnecting.delete(this.username)
	}
	const now = Date.now()
	player.skin = this.skin
	player._avatar = null
	player.sock = this
	player.name = this.username
	this.permissions = permissions
	this.movePacketCd = now / 1000 - 1
	this.joinedAt = now
	this.r = 255
	this.rx = CONFIG.socket.movementcheckmercy
	this.ry = CONFIG.socket.movementcheckmercy
	this.entity = player
	this.packets = []
	if(dim) player.place(dim, x, y)
	players.set(this.username, player)
	player.rubber()
	if(!other){
		stat('misc', 'sessions')
		chat(this.username + (other === null ? ' joined the game' : ' joined the server'), YELLOW)
	}
	this.tbuf = new DataWriter()
	this.ebuf = new DataWriter()
	this.ebuf.byte(20)
	this.tbuf.byte(8)
	sendTabMenu(true)
}

export async function close(){
	if(this.state == 2) return playerLeftQueue()
	this.state = 0
	const {entity} = this
	if(!entity) return
	players.delete(this.username)
	playersConnecting.add(this.username)
	const buf = new DataWriter()
	buf.short(entity.id)
	buf.double(entity.x)
	buf.double(entity.y)
	buf.string(entity.world?.id ?? 'overworld')
	buf.short(entity.state)
	buf.float(entity.dx)
	buf.float(entity.dy)
	buf.float(entity.f)
	buf.double(entity.age)
	buf.flint(entity.savedatahistory.length), buf.write(entity.savedata, entity)
	if(!exiting) chat(entity.name + ' left the game', YELLOW)
	await playersLevel.put(this.username, buf.build())
	playersConnecting.delete(this.username)
	if(entity.world) entity.remove()
	sendTabMenu()
	playerLeft()
}