import http from 'http';
import querystring from 'querystring';

export default function createServer() {
  const routes = {
    GET: {},
    POST: {},
    PUT: {},
    DELETE: {}
  };

  const app = (req, res) => {
    const [path, query] = req.url.split('?');
    req.query = querystring.parse(query);

    res.send = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };

    const handler = routes[req.method]?.[path];

    if (handler) {
      if (req.method === 'POST' || req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            req.body = JSON.parse(body);
          } catch {
            req.body = body;
          }
          handler(req, res);
        });
      } else {
        handler(req, res);
      }
    } else {
      res.status(404).send({ error: 'Not Found' });
    }
  };

  app.get = (path, handler) => { routes.GET[path] = handler; };
  app.post = (path, handler) => { routes.POST[path] = handler; };
  app.put = (path, handler) => { routes.PUT[path] = handler; };
  app.delete = (path, handler) => { routes.DELETE[path] = handler; };

  app.listen = (port, callback) => {
    const server = http.createServer(app);
    server.listen(port, callback);
    return server;
  };

  return app;
}
