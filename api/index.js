import app from "../app.js"

// ================== 【新增】API KEY 校验与 CORS 处理 ==================
const API_KEY = process.env.MY_API_KEY; 

function checkApiKeyAndCors(incoming) {
    // 1. 处理 OPTIONS 预检请求
    if (incoming.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Range, X-API-KEY'
            }
        });
    }

    // 2. 提取请求头
    const headers = {};
    const len = incoming.rawHeaders.length;
    for (let i = 0; i < len; i += 2) {
        headers[incoming.rawHeaders[i]] = incoming.rawHeaders[i + 1];
    }

    // 3. 校验 API Key
    const clientKey = headers['x-api-key'];
    if (clientKey !== API_KEY) {
        console.warn(`[Forbidden] 缺少正确的 X-API-KEY，请求被拒绝`);
        return new Response(JSON.stringify({ error: 'Forbidden: Invalid API Key' }), {
            status: 403,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    // 4. 校验通过，返回 null，让请求继续往下走
    return null;
}
// ================== 【新增】API KEY 校验与 CORS 处理结束 ==================


async function writeReadableStreamToWritable(stream, writable) {
    let reader = stream.getReader()

    async function read() {
        let { done, value } = await reader.read()

        if (done) {
            writable.end()
            return
        }

        writable.write(value)

        await read()
    }

    try {
        await read()
    } catch (error) {
        writable.destroy(error)
        throw error
    }
}

class NodeResponse extends Response {
    get headers() {
        return super.headers
    }

    clone() {
        return super.clone()
    }
}

const getRequestListener = (fetchCallback) => {
    return async (incoming, outgoing) => {
        // 【新增】在这里拦截校验
        const blockedResponse = checkApiKeyAndCors(incoming);
        if (blockedResponse) {
            // 如果被拦截，直接返回 Response，不进入 Hono 框架
            const contentType = blockedResponse.headers.get('content-type') || '';
            outgoing.statusCode = blockedResponse.status;
            for (const [k, v] of blockedResponse.headers) {
                outgoing.setHeader(k, v);
            }
            outgoing.end(await blockedResponse.text());
            return;
        }

        const method = incoming.method || 'GET'
        const url = `http://${incoming.headers.host}${incoming.url}`

        const headerRecord = {}
        const len = incoming.rawHeaders.length
        for (let i = 0; i < len; i++) {
            if (i % 2 === 0) {
                const key = incoming.rawHeaders[i]
                headerRecord[key] = incoming.rawHeaders[i + 1]
            }
        }

        const init = {
            method: method,
            headers: headerRecord,
        }

        if (!(method === 'GET' || method === 'HEAD')) {
            const buffers = []
            for await (const chunk of incoming) {
                buffers.push(chunk)
            }
            const buffer = Buffer.concat(buffers)
            init['body'] = buffer
        }

        let res

        try {
            res = (await fetchCallback(new Request(url.toString(), init)))
        } catch {
            res = new NodeResponse(null, { status: 500 })
        }

        const contentType = res.headers.get('content-type') || ''
        const contentEncoding = res.headers.get('content-encoding')

        for (const [k, v] of res.headers) {
            if (k === 'set-cookie') {
                outgoing.setHeader(k, res.headers.getAll(k))
            } else {
                outgoing.setHeader(k, v)
            }
        }
        outgoing.statusCode = res.status

        if (res.body) {
            if (!contentEncoding && contentType.startsWith('text')) {
                outgoing.end(await res.text())
            } else if (!contentEncoding && contentType.startsWith('application/json')) {
                outgoing.end(await res.text())
            } else {
                await writeReadableStreamToWritable(res.body, outgoing)
            }
        } else {
            outgoing.end()
        }
    }
}

export default getRequestListener(app.fetch)
