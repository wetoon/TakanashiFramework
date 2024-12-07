import type { BunFile } from "bun";
import { resolve, join } from "path";
import { readdirSync, statSync } from "fs";

type ExtractParams<Path extends string> = Path extends `${string}:${infer ParamName}/${infer Rest}`
  ? ParamName | ExtractParams<Rest>
  : Path extends `${string}:${infer ParamName}`
  ? ParamName
  : never;

type HttpMethod = 'GET' | 'POST' | 'HEAD' | 'PUT' | 'DELETE' | 'OPTIONS' | 'PATCH' | 'CONNECT' | 'TRACE';

type HandlerResponse< Param extends string > = {
    method: HttpMethod
    pathname: string
    params: Record<ExtractParams<Param>,string>
    headers: Record<string,string>
    cookies: Record<string,string>
    set: {
        headers: Record<string,string>
        cookies: Record<string,CookieOptions>
        status: number
    }
}

type HandlerReturn = any[] | string | BunFile | Record<any,any>;

type RouteStorage = {
    method: HttpMethod
    pattern: string
    handler: ( context:HandlerResponse<any> ) => Promise<HandlerReturn> | HandlerReturn
}

type CookieOptions = {
    value: string
	domain?: string | undefined
	expires?: Date | undefined
	httpOnly?: boolean | undefined
	maxAge?: number | undefined
	path?: string | undefined
	priority?: 'low' | 'medium' | 'high' | undefined
	partitioned?: boolean | undefined
	sameSite?: true | false | 'lax' | 'strict' | 'none' | undefined
	secure?: boolean | undefined
	secrets?: string | string[]
}

function funcExtractParams( pathname:string, pattern:string ) {
    const xPathname = pathname.split("/").filter( Boolean );
    const xPattern = pattern.split("/").filter( Boolean );
    const params: Record<string, string> = {};
    for ( let i = 0; i < xPattern.length; i++ ) {
        if ( xPattern[i].startsWith(":") ) {
            const paramName = xPattern[i].substring(1);
            params[ paramName ] = xPathname[i];
        }
    }
    return params
}

class CreateResponse {

    public method:HttpMethod;
    public pathname:string;
    public params:Record<string, string>;
    public headers: Record<string,string>;
    public cookies: Record<string,string>;

    public set = {
        headers: {} as Record<string,string>,
        cookies: {} as Record<string,CookieOptions>,
        status: 200
    }

    constructor( request:Request, route:RouteStorage ) {
        this.method = request.method as HttpMethod;
        const requestURL = new URL( request.url );
        this.pathname = requestURL.pathname;
        this.params = funcExtractParams( requestURL.pathname, route.pattern );
        const { cookie, ...headers } = request.headers.toJSON();
        this.headers = headers;
        this.cookies = cookie ? Object.fromEntries( cookie.split("; ").map( cjar => {
            const [ key, value ] = cjar.split("=");
            return [ key, value ];
        })) : {};
    }

}

class Takanashi {

    private staticRoutesMetadata : RouteStorage[] = [];
    private staticFilePaths : string[] = [];

    route< Path extends string >( method:HttpMethod, pattern:Path, handler:( context:HandlerResponse<Path> ) => Promise<HandlerReturn> | HandlerReturn ) {
        this.staticRoutesMetadata.push({ method, pattern, handler });
        return this
    }

    static< DirectoryPathName extends string >( path:DirectoryPathName ) {
        this.collectFiles( resolve( path ) )
        return this
    }

    private collectFiles( directory:string ) {

        const entries = readdirSync( directory );

        for ( const entry of entries ) {

            const entryPath = join( directory, entry );
            const stats = statSync( entryPath );

            if ( stats.isDirectory() ) {
                this.collectFiles( entryPath );
            } else if ( stats.isFile() ) {
                this.staticFilePaths.push( entryPath );
            }

        }

    }

    private funcMatchPath( pattern:string, pathname:string ): boolean {

        if ( pattern == pathname ) return true;

        const routeParts = pathname.split("/").filter( Boolean );
        const actualParts = pattern.split("/").filter( Boolean );
        
        if ( routeParts.length !== actualParts.length ) return false;
        for ( let i = 0; i < routeParts.length; i++ ) {
            if ( !routeParts[i].startsWith(":") && routeParts[i] !== actualParts[i] ) {
                return false
            }
        }
        return true

    }

    private async handlerRoutes( request:Request ) {
        const requestURL = new URL( request.url );
        const route = this.staticRoutesMetadata.find( i => i.method == request.method && this.funcMatchPath( requestURL.pathname, i.pattern ) ) ?? this.staticRoutesMetadata.find( i => ["*","/*"].includes( i.pattern ) );
        if ( route ) {
            const context = new CreateResponse( request, route );

            const response = await route.handler( context );

            const ResponseINI = ( typeof response == "object" && !( response instanceof Blob ) ) ? JSON.stringify( response ) : response;

            const headers = new Headers();

            const resHeaders = context.set.headers;
            for ( const key of Object.keys( resHeaders ) ) {
                headers.set( key, resHeaders[key] )
            }

            const resCookies = context.set.cookies;
            for ( const name of Object.keys( resCookies ) ) {
                const { value, ... options } = resCookies[name];
                options.path = options.path ?? "/";
                options.sameSite = options.sameSite ?? "lax";
                options.expires = options.expires ?? new Date( Date.now() + ( options.maxAge ? ( options.maxAge * 1000 ) : 864e5 ) );
                options.httpOnly = options.httpOnly ?? true;
                options.maxAge = options.maxAge ?? 3600;
                options.priority = options.priority ?? "medium";
                options.partitioned = options.partitioned ?? false;
                options.secure = options.secure ?? true;
                const cookieString = `${name}=${value}; ${Object.entries(options).map(([key, val]) => {
                    if ( typeof val == "boolean" ) return key;
                    if (key === "expires") return `${key}=${val.toUTCString()}`;
                    return `${key}=${val}`;
                }).filter(Boolean).join("; ")}`;
                headers.set( "Set-Cookie", headers.has("Set-Cookie") ? headers.get("Set-Cookie") + `, ${cookieString}` : cookieString );
            }

            switch( typeof response ) {
                case "object":
                    ( !( response instanceof Blob ) && !headers.has("Content-Type") ) && headers.set( "Content-Type", "application/json; charset=utf-8" );
                    break;
                case "string":
                    !headers.has("Content-Type") && headers.set( "Content-Type", "text/plain; charset=utf-8" );
                    break;
                default:
                    break;
            }

            return new Response( ResponseINI as BodyInit, { status:context.set.status, headers } );
            
        }
        return new Response( request.method == "GET" ? "404 Not Found." : JSON.stringify({ code:404, message:"This page cloud not be found" },null,4), { status:404, headers:{ "content-type": request.method == "GET" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8" } } );
    }

    /**
     * @param listenPort - The port to listen on. @default Takanashi.listen(3000)
     */
    listen( listenPort:number = 3000 ) {
        return Bun.serve({
            port: listenPort,
            fetch: async ( request ) => await this.handlerRoutes( request )
        })
    }

}

export { Takanashi }
