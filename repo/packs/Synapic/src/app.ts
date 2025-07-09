import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';

import { Cache } from './dataFetchers';

import { setupRoutes } from './routes';


const app = express();

const PORT = process.env.PORT || 3000;
const IPINFO_TOKEN = process.env.IPINFO_TOKEN;


app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));


setupRoutes(app, IPINFO_TOKEN);


const server = app.listen(PORT, () => {
    console.log(`Synapic Search sunucusu çalışıyor: http://localhost:${PORT}`);

    const cacheStorage = Cache.getStorage();
    const cacheExpiration = 15 * 60 * 1000;

    setInterval(() => {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [key, item] of cacheStorage.entries()) {
            if (item.expiry < now) {
                cacheStorage.delete(key);
                cleanedCount++;
            }
        }


    }, cacheExpiration);

});

process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');

        process.exit(0);
    });
});
