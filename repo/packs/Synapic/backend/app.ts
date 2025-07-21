import { Application, Router, send } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { renderFileToString } from "https://deno.land/x/dejs@0.10.3/mod.ts";
import { checkBangRedirects, fetchBingImages, fetchNewsResults, fetchYoutubeResults, getAggregatedWebResults, fetchWikiSummary, WikiSummary, SearchResult, ImageResult, VideoResult } from "./src/search.ts";
import validApiKeys from "./src/json/keys.json" with { type: "json" };

import { exists } from "https://deno.land/std@0.224.0/fs/exists.ts";
import { dirname, fromFileUrl, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";


interface RenderData {
    query: string;
    type: string;
    start: number;
    results: SearchResult[];
    images: ImageResult[];
    videos: VideoResult[];
    newsResults: SearchResult[];
    wiki: WikiSummary | null;
    countryCode: string;
    elapsedTime: string;
    searchSource: string;
    messageSent?: boolean;
    errorMessage?: string;
    lang: string;
    history?: HistoryItem[];
}

interface ApiResponse {
    query: string;
    type: string;
    searchSource: string;
    wiki: WikiSummary | null;
    results?: SearchResult[];
    images?: ImageResult[];
    videos?: VideoResult[];
    newsResults?: SearchResult[];
    error?: string;
}

interface HistoryItem {
    title: string;
    url: string;
    timestamp: number;
}

const __dirname = dirname(fromFileUrl(import.meta.url));

const PROJECT_ROOT = resolve(__dirname, '..');

const HISTORY_FILE_PATH = resolve(__dirname, "src", "json", "sites.json"); 

const VIEWS_ROOT = resolve(PROJECT_ROOT, "frontend", "views");
const PUBLIC_ROOT = resolve(PROJECT_ROOT, "frontend", "public");

console.log(`[Path Debug] __dirname: ${__dirname}`);
console.log(`[Path Debug] PROJECT_ROOT: ${PROJECT_ROOT}`);
console.log(`[Path Debug] HISTORY_FILE_PATH: ${HISTORY_FILE_PATH}`);
console.log(`[Path Debug] VIEWS_ROOT: ${VIEWS_ROOT}`);
console.log(`[Path Debug] PUBLIC_ROOT: ${PUBLIC_ROOT}`);


async function getHistory(): Promise<HistoryItem[]> {
    try {
        const dir = dirname(HISTORY_FILE_PATH);
        await Deno.mkdir(dir, { recursive: true }).catch((e) => console.error("[getHistory] Dizin oluşturma hatası (varsa göz ardı edilir):", e));
        
        if (!await exists(HISTORY_FILE_PATH)) {
            console.log(`[getHistory] Geçmiş dosyası bulunamadı: ${HISTORY_FILE_PATH}. Yeni dosya oluşturuluyor.`);
            await Deno.writeTextFile(HISTORY_FILE_PATH, JSON.stringify([]));
            return [];
        }

        const fileContent = await Deno.readTextFile(HISTORY_FILE_PATH);
        console.log(`[getHistory] Geçmiş dosyası okundu. İçerik uzunluğu: ${fileContent.length}`);
        if (fileContent.trim() === "") {
            console.warn("[getHistory] Geçmiş dosyası boş, boş dizi olarak yorumlanıyor.");
            return [];
        }
        return JSON.parse(fileContent) as HistoryItem[];
    } catch (error) {
        console.error(`[getHistory] Geçmiş dosyası okunurken veya ayrıştırılırken hata: ${error.message}`);
        return [];
    }
}

async function saveHistory(item: HistoryItem): Promise<void> {
    try {
        console.log(`[saveHistory] Yeni öğe ekleniyor: ${JSON.stringify(item)}`);
        let history = await getHistory();
        console.log(`[saveHistory] Mevcut geçmiş (öncesi): ${history.length} öğe.`);
        
        const isDuplicate = history.some(existingItem => existingItem.url === item.url);
        if (isDuplicate) {
            console.log(`[saveHistory] URL zaten geçmişte var, tekrar eklenmiyor: ${item.url}`);
            return;
        }

        history.unshift(item);
        const MAX_HISTORY_ITEMS = 100;
        if (history.length > MAX_HISTORY_ITEMS) {
            history = history.slice(0, MAX_HISTORY_ITEMS);
            console.log(`[saveHistory] Geçmiş boyutu ${MAX_HISTORY_ITEMS} ile sınırlandı.`);
        }
        const jsonToSave = JSON.stringify(history, null, 2);
        console.log(`[saveHistory] Geçmiş kaydediliyor. Kaydedilecek JSON boyutu: ${jsonToSave.length} byte.`);
        await Deno.writeTextFile(HISTORY_FILE_PATH, jsonToSave);
        console.log("[saveHistory] Geçmiş başarıyla kaydedildi.");
    } catch (error) {
        console.error(`[saveHistory] Geçmiş dosyası kaydedilirken hata: ${error.message}`);
        if (error instanceof Deno.errors.PermissionDenied) {
            console.error("[saveHistory] HATA: Dosya yazma izni reddedildi. Lütfen '--allow-write' iznini kontrol edin.");
        } else if (error instanceof Deno.errors.NotFound) {
            console.error("[saveHistory] HATA: Dosya veya dizin bulunamadı. Yolun doğru olduğundan emin olun.");
        }
    }
}

async function clearAllHistory(): Promise<void> {
    try {
        console.log("[clearAllHistory] Geçmiş temizleniyor...");
        await Deno.writeTextFile(HISTORY_FILE_PATH, JSON.stringify([]));
        console.log("[clearAllHistory] Geçmiş başarıyla temizlendi.");
    } catch (error) {
        console.error(`[clearAllHistory] Geçmiş temizlenirken hata: ${error.message}`);
        if (error instanceof Deno.errors.PermissionDenied) {
            console.error("[clearAllHistory] HATA: Dosya yazma izni reddedildi. Lütfen '--allow-write' iznini kontrol edin.");
        }
        throw error;
    }
}


const app = new Application();
const router = new Router();

const checkApiKey = async (ctx: any, next: () => Promise<unknown>) => {
    const apiKey = ctx.request.url.searchParams.get("apikey");
    if (!apiKey || !validApiKeys.includes(apiKey)) {
        ctx.response.status = 403;
        ctx.response.body = { error: "Geçersiz veya eksik API anahtarı" };
        return;
    }
    await next();
};

app.use(async (ctx, next) => {
    console.log(`[Request Entry] Method: ${ctx.request.method}, Path: ${ctx.request.url.pathname}`);
    await next();
});

app.use(router.routes());
app.use(router.allowedMethods());

router.get("/search", async (ctx) => {
    const startTime = Date.now();
    const query = (ctx.request.url.searchParams.get("query") || ctx.request.url.searchParams.get("q") || "").trim();
    let type = (ctx.request.url.searchParams.get("type") || "web").toLowerCase();
    const start = Math.max(0, parseInt(ctx.request.url.searchParams.get("start") || "0"));
    const lang = (ctx.request.url.searchParams.get("lang") || "tr").toLowerCase();

    if (!query) {
        ctx.response.redirect("/");
        return;
    }

    const bangRedirect = checkBangRedirects(query);
    if (bangRedirect) {
        ctx.response.redirect(bangRedirect);
        return;
    }

    let countryCode = "N/A";

    const renderData: RenderData = {
        query,
        type,
        start,
        results: [],
        images: [],
        newsResults: [],
        videos: [],
        wiki: null,
        countryCode,
        elapsedTime: "0.00",
        searchSource: "Synapic Search",
        errorMessage: undefined,
        lang: lang
    };

    try {
        const fetchPromises: Promise<any>[] = [];
        let searchSourceText = "Sonuçlar";

        if (type === 'wiki') {
            fetchPromises.push(fetchWikiSummary(query, lang)
                .catch((e: Error) => { console.error("Wiki getirme hatası:", e.message); return null; }));
        } else {
            fetchPromises.push(Promise.resolve(null));
        }

        let mainFetchPromise: Promise<any>;

        switch (type) {
            case "web":
                mainFetchPromise = getAggregatedWebResults(query, start, lang);
                searchSourceText = "Web Sonuçları (Birleşik)";
                break;
            case "image":
                mainFetchPromise = fetchBingImages(query, lang);
                searchSourceText = "Görsel Sonuçları (Bing)";
                break;
            case "wiki":
                mainFetchPromise = fetchWikiSummary(query, lang);
                searchSourceText = "Wikipedia Sonucu";
                break;
            case "video":
                mainFetchPromise = fetchYoutubeResults(query, lang);
                searchSourceText = "Video Sonuçları (YouTube)";
                break;
            case "news":
                mainFetchPromise = fetchNewsResults(query, lang);
                searchSourceText = "Haber Sonuçları (gnews.io)";
                break;
            default:
                mainFetchPromise = getAggregatedWebResults(query, start, lang);
                renderData.type = "web";
                type = "web";
                searchSourceText = "Web Sonuçları (Birleşik - Varsayılan)";
        }

        renderData.searchSource = searchSourceText;

        const [wikiResultFromPromise, mainResults] = await Promise.all([
            fetchPromises[0],
            mainFetchPromise.catch((e: Error) => {
                console.error(`${type} getirme hatası:`, e.message);
                return [];
            })
        ]);

        renderData.wiki = (type === "wiki" ? mainResults : wikiResultFromPromise) as WikiSummary | null;

        switch (type) {
            case "web":
                renderData.results = mainResults as SearchResult[] || [];
                renderData.images = [];
                renderData.videos = [];
                renderData.newsResults = [];
                break;
            case "image":
                renderData.images = mainResults as ImageResult[] || [];
                renderData.results = [];
                renderData.videos = [];
                renderData.newsResults = [];
                break;
            case "video":
                renderData.videos = mainResults as VideoResult[] || [];
                renderData.results = [];
                renderData.images = [];
                renderData.newsResults = [];
                break;
            case "wiki":
                renderData.results = [];
                renderData.images = [];
                renderData.videos = [];
                renderData.newsResults = [];
                break;
            case "news":
                renderData.newsResults = mainResults as SearchResult[] || [];
                renderData.results = [];
                renderData.images = [];
                renderData.videos = [];
                break;
            default:
                renderData.results = mainResults as SearchResult[] || [];
                break;
        }

    } catch (error: any) {
        console.error("Arama işleme hatası:", error.message);
        renderData.searchSource = `Sonuçlar alınırken hata oluştu`;
        renderData.errorMessage = error.message;
        renderData.results = [];
        renderData.images = [];
        renderData.videos = [];
        renderData.newsResults = [];
    } finally {
        renderData.elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        if (renderData.errorMessage === undefined) {
            renderData.errorMessage = undefined;
        }
        ctx.response.body = await renderFileToString(`${VIEWS_ROOT}/results.ejs`, renderData);
    }
});

router.get("/api/search", checkApiKey, async (ctx) => {
    const query = (ctx.request.url.searchParams.get("query") || ctx.request.url.searchParams.get("q"))?.trim();
    let type = (ctx.request.url.searchParams.get("type") || "web").toLowerCase();
    const start = Math.max(0, parseInt(ctx.request.url.searchParams.get("start") || "0"));
    const lang = (ctx.request.url.searchParams.get("lang") || "tr").toLowerCase();

    if (!query) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Arama sorgusu eksik!" };
        return;
    }

    try {
        let searchSourceApi: string = "API Sonuçları";

        const wikiPromise = (type === 'wiki') ?
            fetchWikiSummary(query, lang)
            .catch((e: Error) => { console.error("API Wiki getirme hatası:", e.message); return null; })
            : Promise.resolve(null);

        let mainFetchPromise: Promise<any>;

        switch (type) {
            case "web":
                mainFetchPromise = getAggregatedWebResults(query, start, lang);
                searchSourceApi = "Birleşik Web (API)";
                break;
            case "image":
                mainFetchPromise = fetchBingImages(query, lang);
                searchSourceApi = "Bing Görselleri (API)";
                break;
            case "wiki":
                mainFetchPromise = fetchWikiSummary(query, lang);
                searchSourceApi = "Wikipedia (API)";
                break;
            case "video":
                mainFetchPromise = fetchYoutubeResults(query, lang);
                searchSourceApi = "YouTube Videoları (API)";
                break;
            case "news":
                mainFetchPromise = fetchNewsResults(query, lang);
                searchSourceApi = "Haberler (API - gnews.io)";
                break;
            default:
                mainFetchPromise = getAggregatedWebResults(query, start, lang);
                type = "web";
                searchSourceApi = "Birleşik Web (API - Varsayılan)";
        }

        const [wikiResultForOtherTypes, mainResult] = await Promise.all([
            wikiPromise,
            mainFetchPromise.catch((e: Error) => {
                console.error(`API ${type} getirme hatası:`, e.message);
                return [];
            })
        ]);

        const apiResponse: ApiResponse = {
            query,
            type,
            searchSource: searchSourceApi,
            wiki: (type === "wiki" ? mainResult : wikiResultForOtherTypes) as WikiSummary | null,
        };

        switch (type) {
            case "web":
                apiResponse.results = mainResult as SearchResult[] || [];
                break;
            case "image":
                apiResponse.images = mainResult as ImageResult[] || [];
                break;
            case "video":
                apiResponse.videos = mainResult as VideoResult[] || [];
                break;
            case "wiki":
                break;
            case "news":
                apiResponse.newsResults = mainResult as SearchResult[] || [];
                break;
            default:
                apiResponse.results = mainResult as SearchResult[] || [];
                break;
        }

        ctx.response.body = apiResponse;
    } catch (error: any) {
        console.error("API Arama Hatası:", error.message);
        ctx.response.status = 500;
        ctx.response.body = { error: "Arama sırasında bir sunucu hatası oluştu." };
    }
});

router.post("/api/save-history", async (ctx) => {
    console.log(`[Router] /api/save-history POST isteği alındı.`);
    try {
        const body = await ctx.request.body({ type: "json" }).value;
        console.log(`[POST /api/save-history] İstek gövdesi alındı: ${JSON.stringify(body)}`);
        const { title, url } = body;

        if (!title || !url) {
            console.error("[POST /api/save-history] Başlık veya URL eksik.");
            ctx.response.status = 400;
            ctx.response.body = { error: "Başlık veya URL eksik." };
            return;
        }

        const newItem: HistoryItem = {
            title,
            url,
            timestamp: Date.now(),
        };

        await saveHistory(newItem);
        ctx.response.status = 200;
        ctx.response.body = { message: "Geçmiş kaydedildi." };
    } catch (error) {
        console.error(`[POST /api/save-history] Geçmiş kaydetme hatası: ${error.message}`);
        ctx.response.status = 500;
        ctx.response.body = { error: "Geçmiş kaydedilirken bir hata oluştu." };
    }
});

router.get("/api/history", async (ctx) => {
    try {
        const history = await getHistory();
        console.log(`[GET /api/history] Geçmiş başarıyla getirildi. ${history.length} öğe.`);
        ctx.response.status = 200;
        ctx.response.body = history;
    } catch (error) {
        console.error(`[GET /api/history] Geçmiş getirme hatası: ${error.message}`);
        ctx.response.status = 500;
        ctx.response.body = { error: "Geçmiş getirilirken bir hata oluştu." };
    }
});

router.post("/api/clear-history", async (ctx) => {
    try {
        await clearAllHistory();
        ctx.response.status = 200;
        ctx.response.body = { message: "Geçmiş başarıyla temizlendi." };
    } catch (error) {
        console.error(`[POST /api/clear-history] Geçmiş temizleme hatası: ${error.message}`);
        ctx.response.status = 500;
        ctx.response.body = { error: "Geçmiş temizlenirken bir hata oluştu." };
    }
});

router.get("/test-save-history", async (ctx) => {
    const dummyItem: HistoryItem = {
        title: "Test Sayfası",
        url: "http://example.com/test",
        timestamp: Date.now()
    };
    try {
        await saveHistory(dummyItem);
        ctx.response.body = "Test öğesi geçmişe kaydedildi.";
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = `Test öğesi kaydedilirken hata oluştu: ${error.message}`;
    }
});


router.get("/", async (ctx) => {
    const indexPath = `${VIEWS_ROOT}/index.ejs`;
    console.log(`[Render Debug] Attempting to render: ${indexPath}`);
    ctx.response.body = await renderFileToString(indexPath);
});

router.get("/manifesto", async (ctx) => {
    const manifestoPath = `${VIEWS_ROOT}/manifesto.ejs`;
    console.log(`[Render Debug] Attempting to render: ${manifestoPath}`);
    ctx.response.body = await renderFileToString(manifestoPath);
});

router.get("/iletisim", async (ctx) => {
    const iletisimPath = `${VIEWS_ROOT}/iletisim.ejs`;
    console.log(`[Render Debug] Attempting to render: ${iletisimPath}`);
    ctx.response.body = await renderFileToString(iletisimPath, { messageSent: false });
});

router.get("/past", async (ctx) => {
    const pastPath = `${VIEWS_ROOT}/past.ejs`;
    console.log(`[Render Debug] Attempting to render: ${pastPath}`);
    ctx.response.body = await renderFileToString(pastPath);
});

router.get("/privacy", async (ctx) => {
    const privacyPath = `${VIEWS_ROOT}/privacy.ejs`;
    console.log(`[Render Debug] Attempting to render: ${privacyPath}`);
    ctx.response.body = await renderFileToString(privacyPath);
});

router.get("/image", (ctx) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const lang = ctx.request.url.searchParams.get("lang") || "tr";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=image&lang=${encodeURIComponent(lang)}`);
});
router.get("/wiki", (ctx) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const lang = ctx.request.url.searchParams.get("lang") || "tr";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=wiki&lang=${encodeURIComponent(lang)}`);
});
router.get("/video", (ctx) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const lang = ctx.request.url.searchParams.get("lang") || "tr";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=video&lang=${encodeURIComponent(lang)}`);
});
router.get("/news", (ctx) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const lang = ctx.request.url.searchParams.get("lang") || "tr";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=news&lang=${encodeURIComponent(lang)}`);
});

app.use(router.routes());
app.use(router.allowedMethods());

app.use(async (ctx, next) => {
    console.log(`[Static Serve Middleware] Processing. Method: ${ctx.request.method}, Path: ${ctx.request.url.pathname}`);
    if (ctx.request.method === "GET") {
        console.log(`[Static Serve Middleware] Attempting to send static file for GET request: ${ctx.request.url.pathname}`);
        try {
            await send(ctx, ctx.request.url.pathname, {
                root: PUBLIC_ROOT,
                index: "index.html",
            });
        } catch (error) {
            console.warn(`[Static Serve Error] Dosya bulunamadı veya sunulamadı: ${ctx.request.url.pathname} - ${error.message}`);
            await next();
        }
    } else {
        console.log(`[Static Serve Middleware] Skipping static file send for non-GET request. Passing to next middleware.`);
        await next();
    }
});


console.log("Sunucu başlatıldı: http://localhost:8000");
await app.listen({ port: 8000 });