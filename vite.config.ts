import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const EXAMPLE_FILE = fileURLToPath(new URL('./src/example.json', import.meta.url))

/**
 * Dev-only endpoint behind the app's "Save as example" button: POST a graph as JSON
 * and it overwrites src/example.json, which the app imports as its built-in example.
 */
function saveExample(): Plugin {
  return {
    name: 'chainvisual-save-example',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-example', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const graph = JSON.parse(body)
            if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.links)) throw new Error('Not a graph')
            await writeFile(EXAMPLE_FILE, JSON.stringify(graph, null, 2) + '\n')
            res.statusCode = 204
          } catch (err) {
            res.statusCode = 400
            res.write(String(err))
          }
          res.end()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), saveExample()],
})
