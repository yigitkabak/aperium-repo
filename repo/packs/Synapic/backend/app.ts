import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.43/deno-dom-wasm.ts";
import { dirname, fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";

export interface WikipediaSummaryApiResponse {
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

export interface WikiSummary {
    title: string;
    summary: string;
    img: string | null;
    url: string;
}

export interface SearchResult {
    title: string;
    snippet: string;
    displayUrl: string;
    link: string;
    source: string;
    image?: string;
    date?: string;
}

export interface ImageResult {
    image: string;
    thumbnail: string | null;
    title: string;
    link: string;
}

export interface VideoResult {
    title: string;
    url: string;
    thumbnail: string;
    source: string;
}

export interface NewsArticle {
    title: string;
    description: string;
    content: string;
    url: string;
    image?: string;
    publishedAt: string;
    source: {
        name: string;
        url: string;
    };
}

export interface GNewsApiResponse {
    totalArticles: number;
    articles: NewsArticle[];
}

interface CacheItem<T> {
    data: T | null;
    expiry: number;
}

const cacheStorage = new Map<string, CacheItem<any>>();
const cacheExpiration = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

export const Cache = {
    get: function<T>(key: string): T | null {
        const cacheItem = cacheStorage.get(key) as CacheItem<T> | undefined;
        if (cacheItem && cacheItem.expiry > Date.now()) {
            cacheStorage.delete(key);
            cacheStorage.set(key, cacheItem);
            return cacheItem.data;
        }
        cacheStorage.delete(key);
        return null;
    },
    set: function<T>(key: string, data: T | null): void {
        if (data === null || data === undefined || (Array.isArray(data) && data.length === 0)) {
            return;
        }
        if (cacheStorage.size >= MAX_CACHE_SIZE) {
            const oldestKey = cacheStorage.keys().next().value;
            if (oldestKey) {
                cacheStorage.delete(oldestKey);
            }
        }
        cacheStorage.set(key, {
            data,
            expiry: Date.now() + cacheExpiration
        });
    },
    getStorage: function(): Map<string, CacheItem<any>> {
        return cacheStorage;
    },
    clear: function(): void {
        cacheStorage.clear();
    }
};

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SEARX_BASE_URL = "https://searx.be";
const GNEWS_API_KEY = "eaa76e708952a1df00eae28a4b2d3654";
const GNEWS_BASE_URL = "https://gnews.io/api/v4/search";

const langToCountryCode: { [key: string]: string } = {
    "tr": "tr",
    "en": "us",
    "de": "de",
};

const __dirname = dirname(fromFileUrl(import.meta.url));

export async function fetchWikiSummary(query: string, lang: string = "tr"): Promise<WikiSummary | null> {
    const cacheKey = `wiki_summary_${lang}_${query}`;
    const cachedData = Cache.get<WikiSummary>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(5000) });

        if (!response.ok) {
            if (response.status === 404) Cache.set(cacheKey, null);
            return null;
        }

        const data: WikipediaSummaryApiResponse = await response.json();

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
        console.error(`Error fetching WikiSummary (${lang}) for (${query}):`, error.message);
        Cache.set(cacheKey, null);
        return null;
    }
}

export async function fetchBingImages(query: string, lang: string = "tr"): Promise<ImageResult[]> {
    const countryCode = langToCountryCode[lang] || "us";
    const cacheKey = `bing_images_${lang}_${query}`;
    const cachedData = Cache.get<ImageResult[]>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const market = `${lang}-${countryCode.toUpperCase()}`;
        const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1&mkt=${market}`;
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(7000) });
        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const images: ImageResult[] = [];
        document?.querySelectorAll("a.iusc").forEach((el) => {
            const m_attr = (el as unknown as HTMLElement).getAttribute("m");
            if (m_attr) {
                try {
                    const m = JSON.parse(m_attr);
                    if (m && m.murl && m.t) {
                        images.push({
                            title: m.t || query,
                            image: m.murl,
                            thumbnail: m.turl || m.murl,
                            link: m.purl || url
                        });
                    }
                } catch (e: any) { /* Ignore parsing errors */ }
            }
        });
        Cache.set(cacheKey, images);
        return images;
    } catch (error: any) {
        console.error("Error fetching Bing Images:", error.message);
        Cache.set(cacheKey, []);
        return [];
    }
}

export async function fetchYoutubeResults(query: string, lang: string = "tr"): Promise<VideoResult[]> {
    const cacheKey = `youtube_videos_${lang}_${query}`;
    const cachedData = Cache.get<VideoResult[]>(cacheKey);
    if (cachedData) return cachedData;
    try {
        const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=${lang}`;
        const response = await fetch(youtubeSearchUrl, {
            headers: { "User-Agent": USER_AGENT, "Accept-Language": `${lang}-${lang.toUpperCase()},${lang};q=0.9,en-US;q=0.8,en;q=0.7` },
            signal: AbortSignal.timeout(10000)
        });

        const html = await response.text();
        const videos: VideoResult[] = [];
        const regex = /var ytInitialData = ({.*?});<\/script>/s;
        const match = html.match(regex);

        if (match && match[1]) {
            try {
                const ytData = JSON.parse(match[1]);
                const contents = ytData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
                if (contents) {
                    for (const item of contents) {
                        if (item.videoRenderer) {
                            const vr = item.videoRenderer;
                            videos.push({
                                title: vr.title?.runs?.[0]?.text || "No Title",
                                url: `https://www.youtube.com/watch?v=${vr.videoId}`,
                                thumbnail: vr.thumbnail?.thumbnails?.[0]?.url || "",
                                source: vr.ownerText?.runs?.[0]?.text || "YouTube"
                            });
                        }
                        if (videos.length >= 10) break;
                    }
                }
            } catch (e: any) { /* Ignore JSON parsing errors */ }
        }
        Cache.set(cacheKey, videos);
        return videos;
    } catch (error: any) {
        console.error("Error fetching YouTube videos:", error.message);
        Cache.set(cacheKey, []);
        return [];
    }
}

export async function fetchGoogleResults(query: string, start: number = 0, lang: string = "tr"): Promise<SearchResult[]> {
    const countryCode = langToCountryCode[lang] || "us";
    const cacheKey = `google_web_${lang}_${start}_${query}`;
    const cachedData = Cache.get<SearchResult[]>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${start}&hl=${lang}&gl=${countryCode}&lr=lang_${lang}`;
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, "Accept-Language": `${lang}-${lang.toUpperCase()},${lang};q=0.9` },
            signal: AbortSignal.timeout(7000)
        });
        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const results: SearchResult[] = [];
        document?.querySelectorAll("div.g").forEach((element) => {
            const linkElement = element.querySelector("a[jsname][href]");
            let resultUrl = linkElement?.getAttribute("href");
            const title = element.querySelector("h3")?.textContent.trim() || "";
            const snippet = element.querySelector("div[data-sncf=\"1\"]")?.textContent.trim() || "";
            const displayUrl = element.querySelector("cite")?.textContent.trim() || "";

            if (resultUrl && title && !resultUrl.startsWith("/search") && !resultUrl.startsWith("#")) {
                if (resultUrl.startsWith("/url?q=")) {
                    try {
                        const parsedUrlParams = new URLSearchParams(resultUrl.split("?")[1]);
                        resultUrl = parsedUrlParams.get("q") || resultUrl;
                    } catch (e: any) { /* Ignore URL parsing errors */ }
                }
                try {
                    const parsedResultUrl = new URL(resultUrl as string);
                    results.push({
                        title,
                        link: resultUrl as string,
                        snippet,
                        displayUrl: displayUrl || parsedResultUrl.hostname.replace(/^www\./, ""),
                        source: "Google"
                    });
                } catch (e: any) { /* Ignore invalid URLs */ }
            }
        });
        Cache.set(cacheKey, results);
        return results;
    } catch (error: any) {
        console.error("Error fetching Google results:", error.message);
        Cache.set(cacheKey, []);
        return [];
    }
}

export async function fetchBingResults(query: string, start: number = 0, lang: string = "tr"): Promise<SearchResult[]> {
    const first = start + 1;
    const countryCode = langToCountryCode[lang] || "us";
    const cacheKey = `bing_web_${lang}_${first}_${query}`;
    const cachedData = Cache.get<SearchResult[]>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const market = `${lang}-${countryCode.toUpperCase()}`;
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${first}&mkt=${market}`;
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(7000) });
        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const results: SearchResult[] = [];
        document?.querySelectorAll("li.b_algo").forEach((element) => {
            const titleNode = element.querySelector("h2 a");
            const title = titleNode?.textContent.trim() || "";
            const resultUrl = titleNode?.getAttribute("href") || "";
            const snippet = element.querySelector(".b_caption p")?.textContent.trim() ||
                            element.querySelector("div.b_caption div.b_snippet")?.textContent.trim() ||
                            "";
            const displayUrl = element.querySelector("cite")?.textContent.trim() || "";

            if (title && resultUrl) {
                try {
                    const parsedResultUrl = new URL(resultUrl);
                    results.push({
                        title,
                        link: resultUrl,
                        snippet: snippet || "No summary found.",
                        displayUrl: displayUrl || parsedResultUrl.hostname.replace(/^www\./, ""),
                        source: "Bing"
                    });
                } catch (e: any) { /* Ignore invalid URLs */ }
            }
        });
        Cache.set(cacheKey, results);
        return results;
    } catch (error: any) {
        console.error("Error fetching Bing results:", error.message);
        Cache.set(cacheKey, []);
        return [];
    }
}

export async function fetchDuckDuckGoResults(query: string, start: number = 0, lang: string = "tr"): Promise<SearchResult[]> {
    const ddgStart = Math.floor(start / 10) * 20;
    const cacheKey = `duckduckgo_web_${lang}_${ddgStart}_${query}`;
    const cachedData = Cache.get<SearchResult[]>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const ddgLangCode = `${lang}-${lang.toUpperCase()}`;
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${ddgStart}&kl=${ddgLangCode}&df=`;
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, "Accept-Language": `${ddgLangCode},${lang};q=0.8,en-US;q=0.5,en;q=0.3` },
            signal: AbortSignal.timeout(10000)
        });

        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const results: SearchResult[] = [];
        document?.querySelectorAll("div.web-result").forEach((element) => {
            const titleElement = element.querySelector("h2 a.result__a, a.L4EwT6U8e1Y9j49_MIH8");
            const title = titleElement?.textContent.trim() || "";
            let resultUrl = titleElement?.getAttribute("href") || "";
            const snippet = element.querySelector("a.result__snippet, .result__snippet, span.OgdwYG6KE2q5lMyNJA_L")?.textContent.trim() || "";
            let displayUrl = element.querySelector("a.result__url")?.textContent.trim().replace(/^https?:\/\//, "") || "";

            if (title && resultUrl) {
                if (resultUrl.startsWith("//duckduckgo.com/l/?uddg=")) {
                    try {
                        const params = new URLSearchParams(resultUrl.split("?")[1]);
                        const decodedUrl = decodeURIComponent(params.get("uddg") || "");
                        if (decodedUrl) resultUrl = decodedUrl;
                    } catch (e: any) { /* Ignore parsing errors */ }
                }
                if (!resultUrl.startsWith("http")) return;

                try {
                    const parsedResultUrl = new URL(resultUrl);
                    if (!displayUrl) displayUrl = parsedResultUrl.hostname.replace(/^www\./, "");
                    results.push({ title, link: resultUrl, snippet, displayUrl, source: "DuckDuckGo" });
                } catch (e: any) { /* Ignore invalid URLs */ }
            }
        });
        Cache.set(cacheKey, results);
        return results;
    } catch (error: any) {
        console.error("Error fetching DuckDuckGo results:", error.message);
        Cache.set(cacheKey, []);
        return [];
    }
}

export async function fetchSearxResults(query: string, numPages: number = 10, lang: string = "tr"): Promise<SearchResult[]> {
    if (!SEARX_BASE_URL) return [];
    const cacheKey = `searx_web_html_pages_0_to_${numPages - 1}_${lang}_${query}`;
    const cachedData = Cache.get<SearchResult[]>(cacheKey);
    if (cachedData) return cachedData;

    const allSearxResults: SearchResult[] = [];
    const fetchedUrls = new Set<string>();

    for (let page = 0; page < numPages; page++) {
        try {
            const url = `${SEARX_BASE_URL}/search?q=${encodeURIComponent(query)}&p=${page}&language=${lang}`;
            const response = await fetch(url, {
                headers: { "User-Agent": USER_AGENT, "Accept-Language": `${lang}-${lang.toUpperCase()},${lang};q=0.9,en;q=0.8`, "Referer": SEARX_BASE_URL },
                signal: AbortSignal.timeout(15000)
            });
            const html = await response.text();
            const document = new DOMParser().parseFromString(html, "text/html");

            document?.querySelectorAll(".result").forEach((element) => {
                const titleElement = element.querySelector(".result-title a");
                const title = titleElement?.textContent.trim() || "";
                let resultUrl = titleElement?.getAttribute("href") || "";
                const snippet = element.querySelector(".result-content .result-snippet")?.textContent.trim() || "";
                const displayUrl = element.querySelector(".result-url")?.textContent.trim() || "";

                if (resultUrl.startsWith("/url?")) {
                    try {
                        const realUrlParam = new URL(resultUrl, SEARX_BASE_URL).searchParams.get("q");
                        if (realUrlParam) resultUrl = realUrlParam;
                    } catch (e: any) { /* Ignore parsing errors */ }
                }
                if (title && resultUrl && resultUrl !== "#" && !fetchedUrls.has(resultUrl)) {
                    try {
                        const parsedResultUrl = new URL(resultUrl);
                        allSearxResults.push({
                            title,
                            link: resultUrl,
                            snippet: snippet || "No summary found.",
                            displayUrl: displayUrl || parsedResultUrl.hostname.replace(/^www\./, ""),
                            source: "Searx"
                        });
                        fetchedUrls.add(resultUrl);
                    } catch (e: any) { /* Ignore invalid URLs */ }
                }
            });
        } catch (error: any) {
            console.error(`Error fetching Searx page ${page} (${query}):`, error.message);
        }
    }
    Cache.set(cacheKey, allSearxResults);
    return allSearxResults;
}

export async function fetchNewsResults(query: string, lang: string = "tr"): Promise<SearchResult[]> {
    const countryCode = langToCountryCode[lang] || "us";
    const cacheKey = `news_results_${lang}_${query}`;
    const cachedData = Cache.get<SearchResult[]>(cacheKey);
    if (cachedData) return cachedData;

    try {
        const url = `${GNEWS_BASE_URL}?q=${encodeURIComponent(query)}&lang=${lang}&country=${countryCode}&max=10&apikey=${GNEWS_API_KEY}`;
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(7000) });
        const data: GNewsApiResponse = await response.json();

        if (data && data.articles) {
            const newsResults: SearchResult[] = data.articles.map(article => ({
                title: article.title,
                snippet: article.description || "No summary found.",
                link: article.url,
                displayUrl: new URL(article.url).hostname.replace(/^www\./, ""),
                source: article.source?.name || "News Source",
                image: article.image,
                date: article.publishedAt
            }));
            Cache.set(cacheKey, newsResults);
            return newsResults;
        }
        Cache.set(cacheKey, []);
        return [];
    } catch (error: any) {
        console.error("Error fetching news (gnews.io):", error.message);
        Cache.set(cacheKey, []);
        return [];
    }
}

function containsExcludedScripts(text: string): boolean {
    if (!text) return false;
    for (let i = 0; i < text.length; i++) {
        const code = text.codePointAt(i)!;
        if ((code >= 0x0600 && code <= 0x06FF) || (code >= 0x4E00 && code <= 0x9FFF) ||
            (code >= 0x3040 && code <= 0x30FF) || (code >= 0x1100 && code <= 0x11FF) ||
            (code >= 0xAC00 && code <= 0xD7A3)) {
            return true;
        }
    }
    return false;
}

function rankResultsByLanguage(results: SearchResult[], lang: string): SearchResult[] {
    const countryCode = langToCountryCode[lang] || "us";
    const specialEngTlds = ['.co.uk', '.com.au', '.co.nz', '.ca'];
    const genericTlds = ['.com', '.org', '.net', '.info', '.io', '.co', '.edu', '.gov'];

    const getScore = (result: SearchResult): number => {
        try {
            const hostname = new URL(result.link).hostname.toLowerCase();
            if (hostname.endsWith(`.${countryCode}`)) return 4;
            if (lang === 'en' && specialEngTlds.some(tld => hostname.endsWith(tld))) return 3;
            if (genericTlds.some(tld => hostname.endsWith(tld))) return 2;
            return 1;
        } catch (e) {
            return 0;
        }
    };
    return results.sort((a, b) => getScore(b) - getScore(a));
}

export async function getAggregatedWebResults(query: string, start: number = 0, lang: string = "tr"): Promise<SearchResult[]> {
    const FULL_LIST_CACHE_KEY = `full_aggregated_web_${lang}_${query}`;
    let fullCombinedList: SearchResult[] = Cache.get<SearchResult[]>(FULL_LIST_CACHE_KEY) || [];

    if (fullCombinedList.length === 0) {
        try {
            const fetchPromises: Promise<SearchResult[]>[] = [
                fetchGoogleResults(query, 0, lang), fetchGoogleResults(query, 10, lang),
                fetchBingResults(query, 0, lang), fetchBingResults(query, 10, lang),
                fetchDuckDuckGoResults(query, 0, lang), fetchDuckDuckGoResults(query, 20, lang),
                fetchSearxResults(query, 2, lang)
            ];

            const allFetchedResults = await Promise.all(fetchPromises.map(p => p.catch(e => { console.error("A fetch operation failed:", e.message); return []; })));
            const resultsMap = new Map<string, SearchResult>();

            allFetchedResults.flat().forEach(item => {
                if (item?.link && item.title && !resultsMap.has(item.link)) {
                    resultsMap.set(item.link, item);
                }
            });
            fullCombinedList = Array.from(resultsMap.values());
            if (fullCombinedList.length > 0) Cache.set(FULL_LIST_CACHE_KEY, fullCombinedList);

        } catch (error: any) {
            console.error("Error in getAggregatedWebResults:", error.message);
            fullCombinedList = [];
        }
    }

    const filteredList = fullCombinedList.filter(result => !containsExcludedScripts(result.title) && !containsExcludedScripts(result.snippet));
    const sortedList = rankResultsByLanguage(filteredList, lang);
    Cache.clear();
    return sortedList;
}

export function checkBangRedirects(query: string): string | null {
    const parts = query.split(" ");
    const bang = parts[0].toLowerCase();
    const searchQuery = parts.slice(1).join(" ");

    const bangs: { [key: string]: string } = {
        "!g": "https://www.google.com/search?q=",
        "!w": "https://www.wikipedia.org/w/index.php?search=",
        "!bing": "https://www.bing.com/search?q=",
        "!ddg": "https://duckduckgo.com/?q=",
        "!amazon": "https://www.amazon.com/s?k=",
        "!yt": "https://www.youtube.com/results?search_query=",
        "!news": "/news?q="
    };

    if (bangs[bang]) {
        if (bang === "!news") return `${bangs[bang]}${encodeURIComponent(searchQuery)}`;
        return `${bangs[bang]}${encodeURIComponent(searchQuery)}`;
    }
    return null;
}
