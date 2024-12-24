
import { Type } from "@sinclair/typebox";

class Instance {
	listen( port:number ) {
		const httpServer = Bun.serve({
			port, fetch( req, server ) {
				return new Response("Hello")
			}
		})
		console.log(`\n \uD83D\uDE80 Server running at http://localhost:${httpServer.port}\n`)
		return this
	}
}

export { Instance as Takanashi }
