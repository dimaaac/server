import { argv, fs } from '../internals.js'
import { WebSocket, WebSocketServer } from 'ws'
import { Dimensions, players, PERMISSIONS } from '../world/index.js'
import { chat, YELLOW } from '../misc/chat.js'
import { PROTOCOL_VERSION, codes, onstring } from './incomingPacket.js'
import { CONFIG, GAMERULES, HANDLERS, packs, stat, STATS } from '../config.js'
import { DataReader, DataWriter } from '../utils/data.js'
import { playerLeft, playerLeftQueue, queue } from '../misc/queue.js'
import crypto from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { entityindex } from '../entities/index.js'
import { itemindex } from '../items/index.js'
import { blockindex } from '../blocks/index.js'
import { Entities, EntityIDs } from '../entities/entity.js'
import { Items } from '../items/item.js'
import { index } from '../misc/miscdefs.js'

const PUBLICKEY = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA1umjA6HC1ZqCFRSVK1Pd3iSVl82m3UYvSOeZOJgL/yaYnWx47hvo
sXS9GkNjgfl3WATBJ33Q/cigpAi9svLoQgcgkIH+UlMTIJhvuuZ1JK7L6zLwPfyY
s4slcfqVjjC3KsD4Neu2kI9DAw696yiDlSrGFlgVG2GHYjOx1N60CALkKm4oJh1w
dAcg25lE9hao850GIDYqD44BkmbP6KAN1YN0lfyHRwCxmrkNPoFrg5dN1UkwEmnC
gnhKtGgJDdv3MweRrgkyz0aethcpcCF17xlXwszJn/Nyvc+E7+8XIRSbFglij0ei
KOp/re6t/rgyqmjdxEWoXXptl9pjeVnJbwIDAQAB
-----END RSA PUBLIC KEY-----`

const genInfo = () => ({players: ps, playerData: ds, magic_word: CONFIG.magic_word, name: CONFIG.name, icon: CONFIG.icon, motd: CONFIG.motd[floor(random() * CONFIG.motd.length)], stats: STATS})

const endpoints = {
	avatar(res, i){
		const p = players.get(i.split('?',1)[0])
		if(!p) return void res.end('')
		res.setHeader('content-type', 'image/png')
		res.end(p.getAvatar())
	},
	play(res){
		res.setHeader('Location', 'https://preview.openmc.pages.dev/?' + wsHost)
		res.writeHead(301)
		res.end('')
	},
	info(res){
		res.setHeader('content-type', 'application/json')
		res.end(JSON.stringify(genInfo()))
	}
}
const [statsHtml0, statsHtml1] = (await fs.readFile('./server/stats.html')).toString().split('[SERVER_INSERT]')
const handler = (req, res) => {
	if(!wsHost){
		wsHost = (key&&pem ? 'wss://' : 'ws://') + req.headers['host']
		httpHost = wsHost.replace('ws', 'http')
	}
	const [, endpoint, i] = req.url.match(/\/?([\w_\-]+)(?:\/(.*))?/y) || []
	if(!endpoint){
		res.write(statsHtml0)
		const ps = [], ds = []
		for(const p of players.values()) ps.push(p.name), ds.push(p.health)
		res.write(JSON.stringify(genInfo()))
		res.end(statsHtml1)
		return
	}
	const fn = endpoints[endpoint]
	if(fn) fn(res, i, req)
	else res.end('404')
}

const {key, cert = CONFIG.pem} = CONFIG
export const httpServer = key && pem ? (await import('https')).createServer({
	key: await fs.readFile(key[0]=='/'||key[0]=='~' ? key : PATH + '../' + key),
	cert: await fs.readFile(pem[0]=='/'||pem[0]=='~' ? pem : PATH + '../' + pem)
}, handler) : (await import('http')).createServer(handler)
export const secure = !!(key && pem)

export const server = new WebSocketServer({server: httpServer, perMessageDeflate: false})

export let started = 0
server.once('listening', () => started = Date.now())

WebSocket.prototype.logMalicious = function(reason){
	if(!argv.log) return
	console.warn('\x1b[33m' + this._socket.remoteAddress + ' made a malicious packet: ' + reason)
}

const indexCompressed = (b => new Uint8Array(b.buffer, b.byteOffset, b.byteLength))(deflateSync(Buffer.from(blockindex + '\0' + itemindex + '\0' + entityindex + '\0' + index + packs.map(a=>'\0'+a).join(''))))

const playersConnecting = new Set()
export let wsHost = '', httpHost = ''
server.on('connection', function(sock, {url, headers, socket}){
	if(!wsHost){
		wsHost = (key&&pem ? 'wss://' : 'ws://') + headers['host']
		httpHost = wsHost.replace('ws', 'http')
	}
	if(exiting) return
	let [, username, pubKey, authSig] = url.split('/').map(decodeURIComponent)
	if(!username || !pubKey || !authSig)return sock.logMalicious('Malformed Connection'), sock.close()
	sock.entity = null
	sock.username = username
	sock.packets = []
	sock.pubKey = pubKey
	sock.ry = sock.rx = CONFIG.socket.movementcheckmercy
	if(!crypto.verify('SHA256', Buffer.from(username + '\n' + pubKey), PUBLICKEY, Buffer.from(authSig, 'base64')))
		return sock.logMalicious('Invalid public key signature'), sock.close()
	crypto.randomBytes(32, (err, rnd) => {
		if(err) return sock.close()
		sock.challenge = rnd
		const buf = new DataWriter()
		buf.string(CONFIG.name)
		buf.string(CONFIG.motd[floor(random() * CONFIG.motd.length)])
		buf.string(CONFIG.icon)
		buf.uint8array(indexCompressed)
		buf.uint8array(rnd)
		buf.pipe(sock)
		sock.on('message', message)
	})
})
async function play(sock, username, skin){
	if(exiting) return
	if(CONFIG.maxplayers && players.size + playersConnecting.size >= CONFIG.maxplayers){
		sock.on('close', playerLeftQueue)
		if(await queue(sock)) return sock.close()
		sock.removeListener('close', playerLeftQueue)
	}
	let permissions = PERMISSIONS[username] ?? PERMISSIONS.default_permissions ?? 2
	if(permissions*1000 > Date.now()){
		sock.send(permissions == 2147483647 ? '-119You are permanently banned from this server':'-119You are banned from this server for '
			+ Date.formatTime(permissions*1000-Date.now())+(CONFIG.ban_appeal_info?'\nBan appeal: '+CONFIG.ban_appeal_info:''))
		sock.close()
		return
	}else if(permissions == 0){
		sock.send('-11fYou are not invited to play on this server')
		sock.close()
		return
	}else if(permissions == 9){
		sock.send('-10fYour permissions were not correctly set up!\nPlease contact a server admin to fix this issue')
		sock.close()
		return
	}
	let player, dim, x, y
	let other = players.get(username)
	if(other){
		other.sock.send('-119You are logged in from another session')
		other.sock.entity = null
		other.sock.close()
		other.sock = null
		player = other
	}else if(playersConnecting.has(username)){
		sock.send('-119You are still logging in/out from another session')
		sock.logMalicious('Connect / disconnect shamble')
		sock.close()
		return
	}else try{
		playersConnecting.add(username)
		const buf = await HANDLERS.LOADFILE('players/'+username).reader()
		playersConnecting.delete(username)
		if(sock.readyState !== sock.OPEN)return
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
	}
	player.interface = null; player.interfaceId = 0
	player.skin = skin
	player._avatar = null
	player.sock = sock
	player.name = username
	sock.permissions = permissions
	sock.movePacketCd = Date.now() / 1000 - 1
	if(dim) player.place(dim, x, y)
	players.set(username, player)
	sock.r = 255
	sock.joinedAt = Date.now()
	player.rubber()
	sock.entity = player
	if(!other){
		stat('misc', 'sessions')
		chat(username + (other === null ? ' joined the game' : ' joined the server'), YELLOW)
	}
	void (sock.ebuf = new DataWriter()).byte(20)
	sock.tbuf = new DataWriter()
	sock.tbuf.byte(8)
	sock.on('close', close)
	sock.on('error', e => sock.logMalicious('Caused an error: \n'+e.stack))
}

server.sock = {permissions: 4}
server.world = Dimensions.overworld

export const close = async function(){
	const {entity} = this
	if(!entity) return
	players.delete(entity.name)
	playersConnecting.add(entity.name)
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
	await HANDLERS.SAVEFILE('players/' + entity.name, buf.build())
	playersConnecting.delete(entity.name)
	playerLeft()
	if(entity.world) entity.remove()
}

const message = function(_buf, isBinary){
	try{
		const {entity} = this
		if(!entity && this.challenge && isBinary){
			if(_buf.length <= 1008) return
			if(crypto.verify('SHA256', this.challenge, '-----BEGIN RSA PUBLIC KEY-----\n' + this.pubKey + '\n-----END RSA PUBLIC KEY-----', _buf.subarray(1010))){
				const cli_ver = _buf.readUint16BE(0)
				if(cli_ver < PROTOCOL_VERSION)
					return void this.send('-12fOutdated client! Please update your client.\n('+cli_ver+' < '+PROTOCOL_VERSION+')')
				else if(cli_ver > PROTOCOL_VERSION)
					return void this.send('-12fOutdated server! Contact server owner.\n('+cli_ver+' > '+PROTOCOL_VERSION+')')
				play(this, this.username, _buf.subarray(2, 1010))
			}else{
				this.send('-119Invalid signature')
				this.close()
				this.logMalicious('Invalid signature')
			}
			return
		}else if(!entity) return
		if(!isBinary) return void onstring.call(this, entity, _buf.toString())
		const buf = new DataReader(_buf) //let your code breathe
		const code = buf.byte()
		if(!codes[code]) return
		codes[code].call(this, entity, buf)
	}catch(e){ this.logMalicious('Caused an error: \n'+(e.stack??e)) }
}