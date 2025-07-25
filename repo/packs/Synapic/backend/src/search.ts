import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.43/deno-dom-wasm.ts";
import { exists } from "https://deno.land/std@0.224.0/fs/exists.ts";
import { dirname, fromFileUrl, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

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
    if (cachedData) {
        return cachedData;
    }

    try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            if (response.status === 404) {
                Cache.set(cacheKey, null);
                return null;
            }
            throw new Error(`HTTP error code: ${response.status}`);
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
    if (cachedData) {
        return cachedData;
    }
    try {
        const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1&setlang=${lang}&cc=${countryCode}`;
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(7000)
        });
        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const images: ImageResult[] = [];
        document?.querySelectorAll("a.iusc").forEach((el) => {
            const item = el as unknown as HTMLElement;
            const m_attr = item.getAttribute("m");
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
                } catch (e: any) {
                    console.error("Bing image parsing error: ", e.message);
                }
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
    if (cachedData) {
        return cachedData;
    }
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
                            const videoUrl = `https://www.youtube.com/watch?v=${vr.videoId}`;

                            videos.push({
                                title: vr.title?.runs?.[0]?.text || "No Title",
                                url: videoUrl,
                                thumbnail: vr.thumbnail?.thumbnails?.[0]?.url || "",
                                source: vr.ownerText?.runs?.[0]?.text || "YouTube"
                            });
                        }
                        if (videos.length >= 10) break;
                    }
                }
            } catch (e: any) {
                console.error("YouTube JSON data parsing error: ", e.message);
            }
        } else {
            const document = new DOMParser().parseFromString(html, "text/html");
            document?.querySelectorAll("ytd-video-renderer").forEach((el) => {
                const titleElement = el.querySelector("h3 a#video-title");
                const videoId = titleElement?.getAttribute("href")?.replace("/watch?v=", "");
                const title = titleElement?.textContent.trim() || "";
                const thumbnailUrl = el.querySelector("img#img")?.getAttribute("src");
                const ownerText = el.querySelector("yt-formatted-string#owner-text a")?.textContent.trim() || "";

                if (videoId && title && thumbnailUrl) {
                    videos.push({
                        title,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        thumbnail: thumbnailUrl,
                        source: ownerText || "YouTube"
                    });
                }
                if (videos.length >= 10) return false;
            });
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
    if (cachedData) {
        return cachedData;
    }
    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${start}&hl=${lang}&gl=${countryCode}`;
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
            const snippetElement = element.querySelector("div[data-sncf=\"1\"]");
            const snippet = snippetElement?.textContent.trim() || "";
            const displayUrl = element.querySelector("cite")?.textContent.trim() || "";
            if (resultUrl && title && !resultUrl.startsWith("/search") && !resultUrl.startsWith("#")) {
                if (resultUrl.startsWith("/url?q=")) {
                    try {
                        const parsedUrlParams = new URLSearchParams(resultUrl.split("?")[1]);
                        const decodedUrl = parsedUrlParams.get("q") || resultUrl;
                        resultUrl = decodedUrl;
                    } catch (e: any) {
                        console.error("Could not parse Google redirect URL:", e.message);
                    }
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
                } catch (e: any) {
                }
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
    if (cachedData) {
        return cachedData;
    }
    try {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${first}&setlang=${lang}&cc=${countryCode}`;
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(7000)
        });
        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const results: SearchResult[] = [];
        document?.querySelectorAll("li.b_algo").forEach((element) => {
            const titleNode = element.querySelector("h2 a");
            const title = titleNode?.textContent.trim() || "";
            const resultUrl = titleNode?.getAttribute("href") || "";
            const snippetNode = element.querySelector(".b_caption p");
            let snippet = snippetNode?.textContent.trim() || "";
            if (!snippet) {
                snippet = element.querySelector("div.b_caption div.b_snippet")?.textContent.trim() || "";
                if (!snippet) {
                    snippet = element.querySelector(".b_caption p")?.textContent.trim() || "";
                }
            }
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
                } catch (e: any) {
                }
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
    if (cachedData) {
        return cachedData;
    }

    try {
        const ddgLangCode = `${lang}-${lang.toUpperCase()}`;
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${ddgStart}&kl=${ddgLangCode}&df=`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": `${ddgLangCode},${lang};q=0.8,en-US;q=0.5,en;q=0.3`,
                "Referer": "https://duckduckgo.com/"
            },
            signal: AbortSignal.timeout(10000)
        });

        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const results: SearchResult[] = [];

        const resultSelector = "div.web-result";
        const titleSelector = "h2 a.result__a, a.L4EwT6U8e1Y9j49_MIH8";
        const snippetSelector = "a.result__snippet, .result__snippet, span.OgdwYG6KE2q5lMyNJA_L";
        const urlSelector = "a.result__url";

        document?.querySelectorAll(resultSelector).forEach((element) => {
            const titleElement = element.querySelector(titleSelector);
            const title = titleElement?.textContent.trim() || "";
            let resultUrl = titleElement?.getAttribute("href") || "";

            const snippetElement = element.querySelector(snippetSelector);
            const snippet = snippetElement?.textContent.trim() || "";

            const displayUrlElement = element.querySelector(urlSelector);
            let displayUrl = displayUrlElement?.textContent.trim().replace(/^https?:\/\//, "").replace(/^http?:\/\//, "") || "";

            if (title && resultUrl) {
                if (resultUrl.startsWith("//duckduckgo.com/l/?uddg=")) {
                    try {
                        const params = new URLSearchParams(resultUrl.split("?")[1]);
                        const decodedUrl = decodeURIComponent(params.get("uddg") || "");
                        if (decodedUrl) resultUrl = decodedUrl;
                    } catch (e: any) {
                        console.error("Could not parse DuckDuckGo redirect URL:", e.message, resultUrl);
                    }
                } else if (resultUrl.startsWith("/")) {
                    resultUrl = new URL(resultUrl, "https://duckduckgo.com").toString();
                }

                if (!resultUrl.startsWith("http://") && !resultUrl.startsWith("https://")) {
                    return;
                }

                try {
                    const parsedResultUrl = new URL(resultUrl);
                    if (!displayUrl) {
                        displayUrl = parsedResultUrl.hostname.replace(/^www\./, "");
                    }

                    results.push({
                        title,
                        link: resultUrl,
                        snippet,
                        displayUrl,
                        source: "DuckDuckGo"
                    });
                } catch (e: any) {
                    console.error("Could not create DuckDuckGo result URL:", e.message, resultUrl);
                }
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
    if (!SEARX_BASE_URL) {
        console.error("SEARX_BASE_URL is not configured.");
        return [];
    }

    const cacheKey = `searx_web_html_pages_0_to_${numPages - 1}_${lang}_${query}`;
    const cachedData = Cache.get<SearchResult[]>(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    const allSearxResults: SearchResult[] = [];
    const fetchedUrls = new Set<string>();

    for (let page = 0; page < numPages; page++) {
        try {
            const url = `${SEARX_BASE_URL}/search?q=${encodeURIComponent(query)}&p=${page}&lng=${lang}-${lang.toUpperCase()}`;

            const response = await fetch(url, {
                headers: {
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": `${lang}-${lang.toUpperCase()},${lang};q=0.9,en;q=0.8`,
                    "Referer": SEARX_BASE_URL
                },
                signal: AbortSignal.timeout(15000)
            });

            const html = await response.text();
            const document = new DOMParser().parseFromString(html, "text/html");

            const resultSelector = ".result";
            const titleSelector = ".result-title a";
            const snippetSelector = ".result-content .result-snippet";
            const urlSelector = ".result-url";

            document?.querySelectorAll(resultSelector).forEach((element) => {
                const titleElement = element.querySelector(titleSelector);
                const title = titleElement?.textContent.trim() || "";
                let resultUrl = titleElement?.getAttribute("href") || "";

                const snippet = element.querySelector(snippetSelector)?.textContent.trim() || "";
                const displayUrl = element.querySelector(urlSelector)?.textContent.trim() || "";

                if (resultUrl.startsWith("/url?")) {
                    try {
                        const absoluteUrl = new URL(resultUrl, SEARX_BASE_URL).toString();
                        const parsedUrl = new URL(absoluteUrl);
                        const realUrlParam = parsedUrl.searchParams.get("q");
                        if (realUrlParam) {
                            resultUrl = realUrlParam;
                        } else {
                            resultUrl = absoluteUrl;
                        }
                    } catch (e: any) {
                        console.error("Could not parse Searx redirect URL:", e.message, resultUrl);
                        resultUrl = "";
                    }
                } else if (resultUrl.startsWith("/")) {
                    resultUrl = new URL(resultUrl, SEARX_BASE_URL).toString();
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
                    } catch (e: any) {
                        console.error("Could not create Searx result URL:", e.message, resultUrl);
                    }
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
    if (cachedData) {
        return cachedData;
    }

    try {
        const url = `${GNEWS_BASE_URL}?q=${encodeURIComponent(query)}&lang=${lang}&country=${countryCode}&max=10&apikey=${GNEWS_API_KEY}`;
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(7000)
        });

        const data: GNewsApiResponse = await response.json();

        if (data && data.articles) {
            const newsResults: SearchResult[] = data.articles.map(article => {
                let displayUrl = article.url;
                try {
                    const parsedUrl = new URL(article.url);
                    displayUrl = parsedUrl.hostname.replace(/^www\./, "");
                } catch (e) {
                    console.error("News URL parsing error:", e);
                }

                return {
                    title: article.title,
                    snippet: article.description || "No summary found.",
                    link: article.url,
                    displayUrl: displayUrl,
                    source: article.source?.name || "News Source",
                    image: article.image,
                    date: article.publishedAt
                };
            });
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
        const codePoint = text.codePointAt(i)!;

        if (codePoint >= 0x0600 && codePoint <= 0x06FF) return true;
        if (codePoint >= 0x0750 && codePoint <= 0x077F) return true;
        if (codePoint >= 0x08A0 && codePoint <= 0x08FF) return true;
        if (codePoint >= 0xFB50 && codePoint <= 0xFDFF) return true;
        if (codePoint >= 0xFE70 && codePoint <= 0xFEFF) return true;

        if (codePoint >= 0x4E00 && codePoint <= 0x9FFF) return true;
        if (codePoint >= 0x3400 && codePoint <= 0x4DBF) return true;
        if (codePoint >= 0x20000 && codePoint <= 0x2A6DF) return true;
        if (codePoint >= 0x2A700 && codePoint <= 0x2B73F) return true;
        if (codePoint >= 0x2B740 && codePoint <= 0x2B81F) return true;
        if (codePoint >= 0x2B820 && codePoint <= 0x2CEAF) return true;
        if (codePoint >= 0x2CEB0 && codePoint <= 0x2EBEF) return true;
        if (codePoint >= 0x30000 && codePoint <= 0x3134F) return true;
        if (codePoint >= 0x31350 && codePoint <= 0x323AF) return true;

        if (codePoint >= 0x3040 && codePoint <= 0x309F) return true;
        if (codePoint >= 0x30A0 && codePoint <= 0x30FF) return true;
        if (codePoint >= 0x31F0 && codePoint <= 0x31FF) return true;
        if (codePoint >= 0xFF00 && codePoint <= 0xFFEF) return true;

        if (codePoint >= 0x1100 && codePoint <= 0x11FF) return true;
        if (codePoint >= 0x3130 && codePoint <= 0x318F) return true;
        if (codePoint >= 0xA960 && codePoint <= 0xA97F) return true;
        if (codePoint >= 0xAC00 && codePoint <= 0xD7A3) return true;
        if (codePoint >= 0xD7B0 && codePoint <= 0xD7FF) return true;
    }
    return false;
}

export async function getAggregatedWebResults(query: string, start: number = 0, lang: string = "tr"): Promise<SearchResult[]> {
    const FULL_LIST_CACHE_KEY = `full_aggregated_bing_50_ddg_60_searx_pages_10_web_${lang}_${query}`;
    let fullCombinedList: SearchResult[] = Cache.get<SearchResult[]>(FULL_LIST_CACHE_KEY) || [];

    if (fullCombinedList.length === 0) {
        try {
            const MAX_BING_RESULTS = 50;
            const MAX_DDG_RESULTS = 60;
            const MAX_SEARX_PAGES = 10;

            const fetchPromises: Promise<SearchResult[]>[] = [];

            for (let i = 0; i < MAX_BING_RESULTS / 10; i++) {
                fetchPromises.push(fetchBingResults(query, i * 10, lang).catch(e => { console.error(`Bing fetch error (start=${i * 10}):`, e.message); return []; }));
            }

            for (let i = 0; i < MAX_DDG_RESULTS / 20; i++) {
                fetchPromises.push(fetchDuckDuckGoResults(query, i * 20, lang).catch(e => { console.error(`DDG fetch error (start=${i * 20}):`, e.message); return []; }));
            }

            fetchPromises.push(fetchSearxResults(query, MAX_SEARX_PAGES, lang).catch(e => { console.error(`Searx fetch error (${MAX_SEARX_PAGES} pages):`, e.message); return []; }));

            const allFetchedResults = await Promise.all(fetchPromises);

            const resultsMap = new Map<string, SearchResult>();

            allFetchedResults.flat().forEach(item => {
                if (item?.link && item.title && !resultsMap.has(item.link)) {
                    resultsMap.set(item.link, item);
                }
            });

            fullCombinedList = Array.from(resultsMap.values());

            if (fullCombinedList.length > 0) {
                Cache.set(FULL_LIST_CACHE_KEY, fullCombinedList);
            } else {
                if (allFetchedResults.flat().length === 0) {
                    Cache.set(FULL_LIST_CACHE_KEY, []);
                } else {
                    Cache.set(FULL_LIST_CACHE_KEY, fullCombinedList);
                }
            }

        } catch (error: any) {
            console.error("Error fetching or processing the full combined list:", error.message);
            Cache.set(FULL_LIST_CACHE_KEY, []);
            fullCombinedList = [];
        }
    }

    let filteredAndSortedList = fullCombinedList
        .filter(result => {
            return !containsExcludedScripts(result.title) && !containsExcludedScripts(result.snippet);
        });
    
    Cache.clear(); 

    return filteredAndSortedList;
}

export function checkBangRedirects(query: string): string | null {
    const bangs: { [key: string]: string } = {
        "!g": "https://www.google.com/search?q=",
        "!w": "https://tr.wikipedia.org/wiki/Special:Search?search=",
        "!bing": "https://www.bing.com/search?q=",
        "!ddg": "https://duckduckgo.com/?q=",
        "!amazon": "https://www.amazon.com.tr/s?k=",
        "!yt": "https://www.youtube.com/results?search_query=",
        "!news": "/news?q="
    };
    const parts = query.split(" ");
    const bang = parts[0].toLowerCase();
    if (bangs[bang]) {
        const searchQuery = parts.slice(1).join(" ");
        if (bang === "!news") {
            return `${bangs[bang]}${encodeURIComponent(searchQuery)}`;
        }
        return `${bangs[bang]}${encodeURIComponent(searchQuery)}`;
    }
    return null;
}
