import { Entities } from '../../entities/entity.js'
import { damageTypes } from '../../entities/deathmessages.js'
import { Items } from '../../items/item.js'
import { antChunk, chunkTileIndex, down, peek, peekdown, place, summon, up } from '../../misc/ant.js'
import { Block, Blocks } from '../block.js'

Blocks.tnt = class extends Block{
	static breaktime = 0
	drops(){ return Items.tnt(4) }
	destroy(){
		super.destroy(false, null)
		const tnt = summon(Entities.tnt)
		tnt.age = floor(random() * 20) + 55
		return
	}
}

Blocks.fire = class extends Block{
	static solid = false
	static replacable = true
	static mustBreak = true
	static breaktime = 0
	update(){
		const b = peekdown()
		if(b == Blocks.obsidian){
			let i = 0
			while(++i < 32 & (up(), peek().replacable));
			if(peek() != Blocks.obsidian) return
			if(i < 3) return
			while(--i>=0) down(), place(Blocks.portal)
			antChunk.portals.push(chunkTileIndex)
		}else if(b.replacable){
			place(Blocks.air)
		}
	}
	touched(e){
		e.damage?.(1, damageTypes.fire)
	}
}