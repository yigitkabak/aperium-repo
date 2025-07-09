import { Express, Request, Response, NextFunction } from 'express';
import axios, { isAxiosError } from 'axios';
import validApiKeys from '../views/json/ApiKeys.json';
import * as cheerio from 'cheerio';
import { URLSearchParams } from 'url';

interface WikipediaSummaryApiResponse {
    title: string;
    extract: string;
    thumbnail?: {
        source: string;
        width: number;
        height: number;
    };
    content_urls?: {
        desktop?: {
            page: string;
        };
    };
}

interface WikiSummary {
    title: string;
    summary: string;
    img: string | null;
    url: string;
}

interface SearchResult {
    title: string;
    snippet: string;
    displayUrl: string;
    link: string;
    source: string;
}

interface CacheItem<T> {
    data: T | null;
    expiry: number;
}

interface IPInfoData {
    country: string;
}

interface RenderData {
    query: string;
    type: string;
    start: number;
    results: SearchResult[];
    images: [];
    newsResults: [];
    videos: [];
    wiki: WikiSummary | null;
    countryCode: string;
    elapsedTime: string;
    searchSource: string;
    messageSent?: boolean;
}

interface ApiResponse {
    query: string;
    type: string;
    searchSource: string;
    wiki: WikiSummary | null;
    results?: SearchResult[];
    images?: [];
    newsResults?: [];
    videos?: [];
    error?: string;
}

const cacheStorage = new Map<string, CacheItem<any>>();
const cacheExpiration = 15 * 60 * 1000;

export const Cache = {
    get: function<T>(key: string): T | null {
        const cacheItem = cacheStorage.get(key) as CacheItem<T> | undefined;
        if (cacheItem && cacheItem.expiry > Date.now()) {
            return cacheItem.data;
        }
        cacheStorage.delete(key);
        return null;
    },
    set: function<T>(key: string, data: T | null): void {
        if (data === null || data === undefined || (Array.isArray(data) && data.length === 0)) {
            return;
        }
        cacheStorage.set(key, {
            data,
            expiry: Date.now() + cacheExpiration
        });
    },
    getStorage: function(): Map<string, CacheItem<any>> {
        return cacheStorage;
    }
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function fetchWikiSummary(query: string, lang: string = 'tr'): Promise<WikiSummary | null> {
    const cacheKey = `wiki_summary_${lang}_${query}`;
    const cachedData = Cache.get<WikiSummary>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const { data } = await axios.get<WikipediaSummaryApiResponse>(url, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 5000
        });

        if (data && data.title && data.extract) {
            const summary: WikiSummary = {
                title: data.title,
                summary: data.extract,
                img: data.thumbnail?.source || null,
                url: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(query)}`
            };
            Cache.set(cacheKey, summary);
            return summary;
        }

        Cache.set(cacheKey, null);
        return null;
    } catch (error: any) {
        if (isAxiosError(error) && error.response?.status === 404) {
        } else {
            console.error(`WikiSummary (${lang}) getirme hatası (${query}):`, error.message);
        }
        Cache.set(cacheKey, null);
        return null;
    }
}

export function checkBangRedirects(query: string): string | null {
    const bangs: { [key: string]: string } = {
        '!ddg': 'https://duckduckgo.com/?q=',
    };

    const parts = query.split(' ');
    const bang = parts[0].toLowerCase();

    if (bangs[bang]) {
        const searchQuery = parts.slice(1).join(' ');
        return `${bangs[bang]}${encodeURIComponent(searchQuery)}`;
    }

    return null;
}

export async function fetchDuckDuckGoResults(query: string, start: number = 0): Promise<SearchResult[]> {
    const ddgStart = Math.floor(start / 10) * 20;
    const cacheKey = `duckduckgo_web_${ddgStart}_${query}`;
    const cachedData = Cache.get<SearchResult[]>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${ddgStart}&kl=tr-tr&df=`;
        const { data } = await axios.get<string>(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.8,en-US;q=0.5,en;q=0.3',
                'Referer': 'https://duckduckgo.com/'
            },
            timeout: 10000
        });

        const $ = cheerio.load(data);
        const results: SearchResult[] = [];

        $('div.web-result').each((_, element) => {
            const titleElement = $(element).find('h2 a.result__a, a.L4EwT6U8e1Y9j49_MIH8');
            const title = titleElement.text().trim() || '';
            let resultUrl = titleElement.attr('href') || '';

            const snippetElement = $(element).find('a.result__snippet, .result__snippet, span.OgdwYG6KE2q5lMyNJA_L');
            const snippet = snippetElement.text().trim() || '';

            const displayUrlElement = $(element).find('a.result__url');
            let displayUrl = displayUrlElement.text().trim().replace(/^https\?:\/\//, '').replace(/^http\?:\/\//, '');

            if (title && resultUrl) {
                if (resultUrl.startsWith('//duckduckgo.com/l/?uddg=')) {
                    try {
                        const params = new URLSearchParams(resultUrl.split('?')[1]);
                        const decodedUrl = decodeURIComponent(params.get('uddg') || '');
                        if (decodedUrl) resultUrl = decodedUrl;
                    } catch (e: any) {
                        console.error("DuckDuckGo yönlendirme URL'si ayrıştırılamadı:", e.message, resultUrl);
                    }
                }

                if (!resultUrl.startsWith('http://') && !resultUrl.startsWith('https://')) {
                    if (resultUrl.startsWith('//')) {
                        resultUrl = `https:${resultUrl}`;
                    } else {
                        return;
                    }
                }

                try {
                    const parsedResultUrl = new URL(resultUrl);
                    if (!displayUrl) {
                         displayUrl = parsedResultUrl.hostname.replace(/^www\./, '');
                    }

                    results.push({
                        title,
                        link: resultUrl,
                        snippet,
                        displayUrl,
                        source: 'DuckDuckGo'
                    });
                } catch (e: any) {
                    console.error("DuckDuckGo sonuç URL'si oluşturulamadı:", e.message, resultUrl);
                }
            }
        });

        if (results.length > 0) Cache.set(cacheKey, results);
        else Cache.set(cacheKey, []);

        return results;
    } catch (error: any) {
        console.error('DuckDuckGo getirme hatası:', error.message);
        Cache.set(cacheKey, []);
        return [];
    }
}

export function checkApiKey(req: Request, res: Response, next: NextFunction): void {
    const apiKey = req.query.apikey as string | undefined;
    if (!apiKey || !validApiKeys.includes(apiKey)) {
        res.status(403).json({ error: "Geçersiz veya eksik API anahtarı" });
        return;
    }
    next();
}

export function setupRoutes(app: Express, ipinfoToken: string | undefined): void {
    app.get('/search', async (req: Request, res: Response) => {
        const startTime = Date.now();
        const query = (req.query.query as string || req.query.q as string || '').trim();
        const type = 'web';
        const start = Math.max(0, parseInt(req.query.start as string) || 0);

        if (!query) {
            res.redirect('/');
            return;
        }

        const bangRedirect = checkBangRedirects(query);
        if (bangRedirect) {
            res.redirect(bangRedirect);
            return;
        }

        let countryCode = 'N/A';
        if (ipinfoToken) {
            try {
                 const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || '8.8.8.8';
                 const ipCacheKey = `ipinfo_${ip}`;
                 let geoData = Cache.get<IPInfoData>(ipCacheKey);

                 if (!geoData) {
                     const response = await axios.get<IPInfoData>(`https://ipinfo.io/${ip}?token=${ipinfoToken}`, { timeout: 1500 });
                     geoData = response.data;
                     Cache.set(ipCacheKey, geoData);
                 }
                 countryCode = geoData?.country || 'N/A';

            } catch (error: any) {
                 console.error("IP Info fetch error:", error.message);
            }
        }


        const renderData: RenderData = {
            query, type, start, results: [], images: [], newsResults: [],
            videos: [], wiki: null, countryCode, elapsedTime: '0.00',
            searchSource: 'DuckDuckGo Web Sonuçları'
        };

        try {
            const fetchPromises: Promise<any>[] = [];

            fetchPromises.push(fetchWikiSummary(query, 'tr')
                .catch((e: Error) => { console.error("Wiki fetch failed inline:", e.message); return null; }));

            fetchPromises.push(fetchDuckDuckGoResults(query, start)
                .catch((e: Error) => { console.error("DuckDuckGo fetch failed inline:", e.message); return []; }));


            const [wikiResult, mainResults] = await Promise.all(fetchPromises);

            renderData.wiki = wikiResult as WikiSummary | null;
            renderData.results = mainResults as SearchResult[] || [];


        } catch (error: any) {
            console.error("Error during search processing:", error.message);
            renderData.searchSource = `Sonuçlar alınırken hata oluştu`;
        } finally {
            renderData.elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
            res.render('results', renderData);
        }
    });

    app.get('/api/search', checkApiKey, async (req: Request, res: Response) => {
         const query = (req.query.query as string || req.query.q as string)?.trim();
         const type = 'web';
         const start = Math.max(0, parseInt(req.query.start as string) || 0);

         if (!query) {
             res.status(400).json({ error: "Arama sorgusu eksik!" });
             return;
         }

         try {
            const searchSourceApi: string = 'DuckDuckGo Web';

            const wikiPromise = fetchWikiSummary(query, 'tr')
                .catch((e: Error) => { console.error("API Wiki fetch failed:", e.message); return null; });

            const mainFetchPromise = fetchDuckDuckGoResults(query, start)
                .catch((e: Error) => { console.error(`API DuckDuckGo fetch failed:`, e.message); return []; });


            const [wiki, mainResults] = await Promise.all([
                 wikiPromise,
                 mainFetchPromise
            ]);

            const apiResponse: ApiResponse = {
                query, type, searchSource: searchSourceApi, wiki: wiki as WikiSummary | null,
                results: mainResults as SearchResult[]
            };

            res.json(apiResponse);
         } catch (error: any) {
            console.error("API Search Error:", error.message);
            res.status(500).json({ error: "Arama sırasında bir sunucu hatası oluştu." });
         }
    });

    app.get('/', (req: Request, res: Response) => res.render('index'));
    app.get('/manifesto', (req: Request, res: Response) => res.render('manifesto'));
    app.get('/iletisim', (req: Request, res: Response) => res.render('iletisim', { messageSent: false }));

    app.get('/google', (req: Request, res: Response) => {
        const query = req.query.q as string || '';
        res.redirect(`/search?query=${encodeURIComponent(query)}&type=web`);
    });

    app.get('/bing', (req: Request, res: Response) => {
        const query = req.query.q as string || '';
        res.redirect(`/search?query=${encodeURIComponent(query)}&type=web`);
    });

    app.get('/duckduckgo', (req: Request, res: Response) => {
        const query = req.query.q as string || '';
        res.redirect(`/search?query=${encodeURIComponent(query)}&type=web`);
    });
}
