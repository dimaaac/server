import { Dimensions } from './world/index.js'
import './utils/prototypes.js'
import { CONFIG, HANDLERS, STATS, DEFAULT_TPS } from './config.js'
import { setTPS } from './world/tick.js'
import { close, httpServer, server } from './server.js'
import { ready } from './internals.js'


process.stdout.write('\x1bc\x1b[3J')
progress('All modules loaded')

await ready
httpServer.listen(CONFIG.port || 27277)
setTPS(DEFAULT_TPS)

globalThis.exiting = false
let promises = []
process.on('SIGINT', _ => {
	//Save stuff here
	if(exiting) return console.log('\x1b[33mTo force shut down the server, evaluate \x1b[30mprocess.exit(0)\x1b[33m in the repl\x1b[m')
	console.log('\x1b[33mShutting down gracefully...\x1b[m')
	server.close()
	exiting = true
	Promise.all(promises).then(() => {
		promises.length = 0
		for(const sock of server.clients) promises.push(close.call(sock))
		saveAll(() => process.exit(0))
	})
})
function saveAll(cb){	
	for(const name in Dimensions){
		const d = Dimensions[name]
		promises.push(HANDLERS.SAVEFILE('dimensions/'+name+'.json', JSON.stringify({tick: d.tick})))
		for (const ch of d.values()) d.save(ch)
	}
	promises.push(HANDLERS.SAVEFILE('stats.json', JSON.stringify(STATS)))
	Promise.all(promises).then(cb)
}
void function timeout(){if(exiting) return; promises.length = 0; setTimeout(saveAll, 300e3, timeout)}()