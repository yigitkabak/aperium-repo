import { Application, Router, send } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { renderFileToString } from "https://deno.land/x/dejs@0.10.3/mod.ts";
import { checkBangRedirects, fetchBingImages, fetchNewsResults, fetchYoutubeResults, getAggregatedWebResults, fetchWikiSummary, WikiSummary, SearchResult, ImageResult, VideoResult } from "./src/search.ts";
import validApiKeys from "./src/json/keys.json" with { type: "json" };

import { exists } from "https://deno.land/std@0.224.0/fs/exists.ts";
import { dirname, fromFileUrl, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";


interface RenderData {
    query: string;
    type: string;
    currentPage: number;
    resultsPerPage: number;
    totalResults: number;
    totalPages: number;
    
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
    currentPage: number;
    resultsPerPage: number;
    totalResults: number;
    totalPages: number;

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
    deviceId: string;
}

interface ServiceStatus {
    name: string;
    status: string;
    statusClass: string;
    availability: number;
    minResponseTime: number;
    avgResponseTime: number;
    maxResponseTime: number;
}

interface OverallStatusData {
    timestamp: string;
    overallStatus: string;
    services: ServiceStatus[];
    statusClass?: string;
}


const __dirname = dirname(fromFileUrl(import.meta.url));

const PROJECT_ROOT = resolve(__dirname, '..');

const HISTORY_FILE_PATH = resolve(__dirname, "src", "json", "sites.json");
const STATUS_LOG_FILE_PATH = resolve(__dirname, "src", "json", "status.json");


const VIEWS_ROOT = resolve(PROJECT_ROOT, "frontend", "views");
const PUBLIC_ROOT = resolve(PROJECT_ROOT, "frontend", "public");

const RESULTS_PER_PAGE = 20;

async function getHistory(): Promise<HistoryItem[]> {
    try {
        const dir = dirname(HISTORY_FILE_PATH);
        await Deno.mkdir(dir, { recursive: true }).catch((e) => console.error("Directory creation error (ignored if exists):", e));
        
        if (!await exists(HISTORY_FILE_PATH)) {
            console.log(`History file not found: ${HISTORY_FILE_PATH}. Creating new file.`);
            await Deno.writeTextFile(HISTORY_FILE_PATH, JSON.stringify([]));
            return [];
        }

        const fileContent = await Deno.readTextFile(HISTORY_FILE_PATH);
        console.log(`History file read. Content length: ${fileContent.length}`);
        if (fileContent.trim() === "") {
            console.warn("History file is empty, interpreting as empty array.");
            return [];
        }
        let history: HistoryItem[] = JSON.parse(fileContent) as HistoryItem[];
        
        return history;
    } catch (error) {
        console.error(`Error reading or parsing history file: ${error.message}`);
        return [];
    }
}

async function saveHistory(item: HistoryItem): Promise<void> {
    try {
        console.log(`Adding new item: ${JSON.stringify(item)}`);
        let history = await getHistory();
        console.log(`Current history (before): ${history.length} items.`);
        
        const isDuplicate = history.some(existingItem => existingItem.url === item.url && existingItem.deviceId === item.deviceId);
        if (isDuplicate) {
            console.log(`URL and Device ID already exist in history, not adding again: ${item.url} (${item.deviceId})`);
            return;
        }

        history.unshift(item);
        const MAX_HISTORY_ITEMS = 100;
        if (history.length > MAX_HISTORY_ITEMS) {
            history = history.slice(0, MAX_HISTORY_ITEMS);
            console.log(`History size limited to ${MAX_HISTORY_ITEMS}.`);
        }
        const jsonToSave = JSON.stringify(history, null, 2);
        console.log(`Saving history. JSON size to save: ${jsonToSave.length} bytes.`);
        await Deno.writeTextFile(HISTORY_FILE_PATH, jsonToSave);
        console.log("History successfully saved.");
    } catch (error) {
        console.error(`Error saving history file: ${error.message}`);
        if (error instanceof Deno.errors.PermissionDenied) {
            console.error("ERROR: File write permission denied. Please check '--allow-write' permission.");
        } else if (error instanceof Deno.errors.NotFound) {
            console.error("ERROR: File or directory not found. Ensure the path is correct.");
        }
    }
}

async function clearAllHistory(): Promise<void> {
    try {
        console.log("Clearing history...");
        await Deno.writeTextFile(HISTORY_FILE_PATH, JSON.stringify([]));
        console.log("History successfully cleared.");
    } catch (error) {
        console.error(`Error clearing history: ${error.message}`);
        if (error instanceof Deno.errors.PermissionDenied) {
            console.error("ERROR: File write permission denied. Please check '--allow-write' permission.");
        }
        throw error;
    }
}

async function updateStatusPeriodically() {
    console.log("[Status Updater] Checking and updating status...");
    try {
        let allLogs: OverallStatusData[] = [];
        if (await exists(STATUS_LOG_FILE_PATH)) {
            const fileContent = await Deno.readTextFile(STATUS_LOG_FILE_PATH);
            if (fileContent.trim() !== "") {
                try {
                    allLogs = JSON.parse(fileContent) as OverallStatusData[];
                } catch (jsonError) {
                    console.error("[Status Updater] Error parsing existing status_logs.json:", jsonError.message);
                    allLogs = [];
                }
            }
        } else {

            const dir = dirname(STATUS_LOG_FILE_PATH);
            await Deno.mkdir(dir, { recursive: true }).catch(e => console.warn(`[Status Updater] Directory creation failed (ignored if exists): ${e.message}`));
        }

        const currentTimestamp = new Date().toISOString();
        const shouldBeActive = allLogs.length % 2 === 0;
        const newOverallStatus = shouldBeActive ? "All services active" : "Some services interrupted";
        const newStatusClass = shouldBeActive ? "green" : "red";

        const newEntry: OverallStatusData = {
            timestamp: currentTimestamp,
            overallStatus: newOverallStatus,
            services: [
                {
                    name: "synapic",
                    status: shouldBeActive ? "Operational" : "Interrupted",
                    statusClass: shouldBeActive ? "" : "down",
                    availability: shouldBeActive ? 100 : 0,
                    minResponseTime: 0.05,
                    avgResponseTime: 0.06,
                    maxResponseTime: 0.1
                },
                {
                    name: "api",
                    status: "Operational",
                    statusClass: "",
                    availability: 100,
                    minResponseTime: 0,
                    avgResponseTime: 0,
                    maxResponseTime: 0
                }
            ],
            statusClass: newStatusClass
        };

        allLogs.push(newEntry);

        const MAX_STATUS_LOGS = 50;
        if (allLogs.length > MAX_STATUS_LOGS) {
            allLogs = allLogs.slice(allLogs.length - MAX_STATUS_LOGS);
        }

        await Deno.writeTextFile(STATUS_LOG_FILE_PATH, JSON.stringify(allLogs, null, 2));
        console.log(`[Status Updater] Status updated to: "${newOverallStatus}" at ${currentTimestamp}`);
    } catch (error) {
        console.error("[Status Updater] Failed to update status logs:", error.message);
    }
}


const app = new Application();
const router = new Router();

const checkApiKey = async (ctx: any, next: () => Promise<unknown>) => {
    const apiKey = ctx.request.url.searchParams.get("apikey");
    if (!apiKey || !validApiKeys.includes(apiKey)) {
        ctx.response.status = 403;
        ctx.response.body = { error: "Invalid or missing API key" };
        return;
    }
    await next();
};

app.use(async (ctx, next) => {
    console.log(`[Request Entry] Method: ${ctx.request.method}, Path: ${ctx.request.url.pathname}`);
    await next();
});

router.get("/search", async (ctx) => {
    const startTime = Date.now();
    const query = (ctx.request.url.searchParams.get("query") || ctx.request.url.searchParams.get("q") || "").trim();
    let type = (ctx.request.url.searchParams.get("type") || "web").toLowerCase();
    const page = Math.max(1, parseInt(ctx.request.url.searchParams.get("page") || "1")); 
    const lang = (ctx.request.url.searchParams.get("lang") || "tr").toLowerCase();
    const deviceId = (ctx.request.url.searchParams.get("deviceId") || "").trim();


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
        currentPage: page,
        resultsPerPage: RESULTS_PER_PAGE,
        totalResults: 0,
        totalPages: 0,
        
        results: [],
        images: [],
        videos: [],
        newsResults: [],
        wiki: null,
        countryCode,
        elapsedTime: "0.00",
        searchSource: "Synapic Search",
        errorMessage: undefined,
        lang: lang
    };

    try {
        const fetchPromises: Promise<any>[] = [];
        let searchSourceText = "Results";

        if (type === 'wiki') {
            fetchPromises.push(fetchWikiSummary(query, lang)
                .catch((e: Error) => { console.error("Wiki fetch error:", e.message); return null; }));
        } else {
            fetchPromises.push(Promise.resolve(null));
        }

        let mainFetchPromise: Promise<any>;

        switch (type) {
            case "web":
                mainFetchPromise = getAggregatedWebResults(query, 0, lang); 
                searchSourceText = "Web Results (Aggregated)";
                break;
            case "image":
                mainFetchPromise = fetchBingImages(query, lang);
                searchSourceText = "Image Results (Bing)";
                break;
            case "wiki":
                mainFetchPromise = fetchWikiSummary(query, lang);
                searchSourceText = "Wikipedia Result";
                break;
            case "video":
                mainFetchPromise = fetchYoutubeResults(query, lang);
                searchSourceText = "Video Results (YouTube)";
                break;
            case "news":
                mainFetchPromise = fetchNewsResults(query, lang);
                searchSourceText = "News Results (gnews.io)";
                break;
            default:
                mainFetchPromise = getAggregatedWebResults(query, 0, lang);
                renderData.type = "web";
                type = "web";
                searchSourceText = "Web Results (Aggregated - Default)";
        }

        renderData.searchSource = searchSourceText;

        const [wikiResultFromPromise, mainResultsFull] = await Promise.all([
            fetchPromises[0],
            mainFetchPromise.catch((e: Error) => {
                console.error(`${type} fetch error:`, e.message);
                return [];
            })
        ]);

        renderData.wiki = (type === "wiki" ? mainResultsFull : wikiResultFromPromise) as WikiSummary | null;

        let paginatedResults: any[] = [];
        let totalItems: number = 0;

        switch (type) {
            case "web":
                const webResultsFull = mainResultsFull as SearchResult[] || [];
                totalItems = webResultsFull.length;
                paginatedResults = webResultsFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                renderData.results = paginatedResults as SearchResult[];
                renderData.images = [];
                renderData.videos = [];
                renderData.newsResults = [];
                break;
            case "image":
                const imagesFull = mainResultsFull as ImageResult[] || [];
                totalItems = imagesFull.length;
                paginatedResults = imagesFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                renderData.images = paginatedResults as ImageResult[];
                renderData.results = [];
                renderData.videos = [];
                renderData.newsResults = [];
                break;
            case "video":
                const videosFull = mainResultsFull as VideoResult[] || [];
                totalItems = videosFull.length;
                paginatedResults = videosFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                renderData.videos = paginatedResults as VideoResult[];
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
                const newsFull = mainResultsFull as SearchResult[] || [];
                totalItems = newsFull.length;
                paginatedResults = newsFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                renderData.newsResults = paginatedResults as SearchResult[];
                renderData.results = [];
                renderData.images = [];
                renderData.videos = [];
                break;
            default:
                const defaultResultsFull = mainResultsFull as SearchResult[] || [];
                totalItems = defaultResultsFull.length;
                paginatedResults = defaultResultsFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                renderData.results = paginatedResults as SearchResult[];
                break;
        }

        renderData.totalResults = totalItems;
        renderData.totalPages = Math.ceil(totalItems / RESULTS_PER_PAGE);
        if (page > renderData.totalPages && renderData.totalPages > 0) {
            ctx.response.redirect(`/search?q=${encodeURIComponent(query)}&type=${type}&lang=${encodeURIComponent(lang)}&page=1`);
            return;
        }
        if (totalItems === 0 && page > 1) {
             ctx.response.redirect(`/search?q=${encodeURIComponent(query)}&type=${type}&lang=${encodeURIComponent(lang)}&page=1`);
            return;
        }


    } catch (error: any) {
        console.error("Search processing error:", error.message);
        renderData.searchSource = `Error fetching results`;
        renderData.errorMessage = error.message;
        renderData.results = [];
        renderData.images = [];
        renderData.videos = [];
        renderData.newsResults = [];
        renderData.totalResults = 0;
        renderData.totalPages = 0;
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
    const page = Math.max(1, parseInt(ctx.request.url.searchParams.get("page") || "1"));
    const lang = (ctx.request.url.searchParams.get("lang") || "tr").toLowerCase();
    const deviceId = (ctx.request.url.searchParams.get("deviceId") || "").trim();


    if (!query) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Search query missing!" };
        return;
    }

    try {
        let searchSourceApi: string = "API Results";

        const wikiPromise = (type === 'wiki') ?
            fetchWikiSummary(query, lang)
            .catch((e: Error) => { console.error("API Wiki fetch error:", e.message); return null; })
            : Promise.resolve(null);

        let mainFetchPromise: Promise<any>;

        switch (type) {
            case "web":
                mainFetchPromise = getAggregatedWebResults(query, 0, lang);
                searchSourceApi = "Aggregated Web (API)";
                break;
            case "image":
                mainFetchPromise = fetchBingImages(query, lang);
                searchSourceApi = "Bing Images (API)";
                break;
            case "wiki":
                mainFetchPromise = fetchWikiSummary(query, lang);
                searchSourceApi = "Wikipedia (API)";
                break;
            case "video":
                mainFetchPromise = fetchYoutubeResults(query, lang);
                searchSourceApi = "YouTube Videos (API)";
                break;
            case "news":
                mainFetchPromise = fetchNewsResults(query, lang);
                searchSourceApi = "News (API - gnews.io)";
                break;
            default:
                mainFetchPromise = getAggregatedWebResults(query, 0, lang);
                type = "web";
                searchSourceApi = "Aggregated Web (API - Default)";
        }

        const [wikiResultForOtherTypes, mainResultFull] = await Promise.all([
            wikiPromise,
            mainFetchPromise.catch((e: Error) => {
                console.error(`API ${type} fetch error:`, e.message);
                return [];
            })
        ]);

        let paginatedResults: any[] = [];
        let totalItems: number = 0;

        switch (type) {
            case "web":
                const webResultsFull = mainResultFull as SearchResult[] || [];
                totalItems = webResultsFull.length;
                paginatedResults = webResultsFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                break;
            case "image":
                const imagesFull = mainResultFull as ImageResult[] || [];
                totalItems = imagesFull.length;
                paginatedResults = imagesFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                break;
            case "video":
                const videosFull = mainResultFull as VideoResult[] || [];
                totalItems = videosFull.length;
                paginatedResults = videosFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                break;
            case "wiki":
                break;
            case "news":
                const newsFull = mainResultFull as SearchResult[] || [];
                totalItems = newsFull.length;
                paginatedResults = newsFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                break;
            default:
                const defaultResultsFull = mainResultFull as SearchResult[] || [];
                totalItems = defaultResultsFull.length;
                paginatedResults = defaultResultsFull.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
                break;
        }

        const apiResponse: ApiResponse = {
            query,
            type,
            searchSource: searchSourceApi,
            wiki: (type === "wiki" ? mainResultFull : wikiResultForOtherTypes) as WikiSummary | null,
            currentPage: page,
            resultsPerPage: RESULTS_PER_PAGE,
            totalResults: totalItems,
            totalPages: Math.ceil(totalItems / RESULTS_PER_PAGE)
        };

        switch (type) {
            case "web":
                apiResponse.results = paginatedResults as SearchResult[] || [];
                break;
            case "image":
                apiResponse.images = paginatedResults as ImageResult[] || [];
                break;
            case "video":
                apiResponse.videos = paginatedResults as VideoResult[] || [];
                break;
            case "wiki":
                break;
            case "news":
                apiResponse.newsResults = paginatedResults as SearchResult[] || [];
                break;
            default:
                apiResponse.results = paginatedResults as SearchResult[] || [];
                break;
        }

        ctx.response.body = apiResponse;
    } catch (error: any) {
        console.error("API Search Error:", error.message);
        ctx.response.status = 500;
        ctx.response.body = { error: "A server error occurred during search." };
    }
});


router.post("/api/save-history", async (ctx) => {
    console.log(`[Router] /api/save-history POST request received.`);
    try {
        const body = await ctx.request.body({ type: "json" }).value;
        console.log(`[POST /api/save-history] Request body received: ${JSON.stringify(body)}`);
        const { title, url, deviceId } = body;

        if (!title || !url || !deviceId) {
            console.error("[POST /api/save-history] Title, URL, or Device ID missing.");
            ctx.response.status = 400;
            ctx.response.body = { error: "Title, URL, or Device ID missing." };
            return;
        }

        const newItem: HistoryItem = {
            title,
            url,
            timestamp: Date.now(),
            deviceId: deviceId
        };

        await saveHistory(newItem);
        ctx.response.status = 200;
        ctx.response.body = { message: "History saved." };
    } catch (error) {
        console.error(`[POST /api/save-history] History save error: ${error.message}`);
        ctx.response.status = 500;
        ctx.response.body = { error: "An error occurred while saving history." };
    }
});

router.get("/api/history", async (ctx) => {
    try {
        const clientDeviceId = ctx.request.headers.get('X-Device-ID');
        console.log(`[GET /api/history] History request received. Client Device ID: ${clientDeviceId}`);

        if (!clientDeviceId) {
            console.error("[GET /api/history] Device ID header missing.");
            ctx.response.status = 400;
            ctx.response.body = { error: "Device ID header missing." };
            return;
        }

        const allHistory = await getHistory();
        const filteredHistory = allHistory.filter(item => item.deviceId === clientDeviceId);

        console.log(`[GET /api/history] History successfully retrieved. ${filteredHistory.length} items (filtered by Device ID).`);
        ctx.response.status = 200;
        ctx.response.body = filteredHistory;
    } catch (error) {
        console.error(`[GET /api/history] History retrieval error: ${error.message}`);
        ctx.response.status = 500;
        ctx.response.body = { error: "An error occurred while retrieving history." };
    }
});

router.post("/api/clear-history", async (ctx) => {
    try {
        await clearAllHistory();
        ctx.response.status = 200;
        ctx.response.body = { message: "History successfully cleared." };
    }
    catch (error) {
        console.error(`[POST /api/clear-history] History clear error: ${error.message}`);
        ctx.response.status = 500;
        ctx.response.body = { error: "An error occurred while clearing history." };
    }
});

router.get("/api/latest-status", async (ctx) => {
    try {
        if (!await exists(STATUS_LOG_FILE_PATH)) {
            console.error(`[GET /api/latest-status] Status logs file not found at: ${STATUS_LOG_FILE_PATH}`);
            ctx.response.status = 404;
            ctx.response.body = { error: "Status logs not found." };
            return;
        }

        const fileContent = await Deno.readTextFile(STATUS_LOG_FILE_PATH);
        if (fileContent.trim() === "") {
            console.warn(`[GET /api/latest-status] Status logs file is empty at: ${STATUS_LOG_FILE_PATH}`);
            ctx.response.status = 404;
            ctx.response.body = { error: "Status logs file is empty." };
            return;
        }

        let allLogs: OverallStatusData[];
        try {
            allLogs = JSON.parse(fileContent) as OverallStatusData[];
        } catch (jsonError) {
            console.error(`[GET /api/latest-status] Error parsing status_logs.json at ${STATUS_LOG_FILE_PATH}: ${jsonError.message}`);
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to parse status log data." };
            return;
        }

        if (allLogs.length > 0) {
            const latestStatus = allLogs[allLogs.length - 1];
            
            let statusClass = 'red';
            if (latestStatus.overallStatus === "All services active") {
                statusClass = 'green';
            } else if (latestStatus.overallStatus === "Low Performance" || latestStatus.overallStatus === "Some services interrupted") {
                const hasDownService = latestStatus.services.some(s => s.status === "Interrupted");
                if (hasDownService) {
                    statusClass = 'red';
                } else {
                    statusClass = 'yellow';
                }
            }

            const responseData = {
                ...latestStatus,
                statusClass: statusClass
            };

            ctx.response.status = 200;
            ctx.response.body = responseData;
            ctx.response.type = "application/json";
        } else {
            console.warn("[GET /api/latest-status] No status data available in logs (array is empty).");
            ctx.response.status = 404;
            ctx.response.body = { error: "No status data available in logs." };
        }
    } catch (error) {
        console.error(`[GET /api/latest-status] Error fetching latest status: ${error.message}`);
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to retrieve latest status data." };
    }
});


router.get("/test-save-history", async (ctx) => {
    const dummyItem: HistoryItem = {
        title: "Test Page",
        url: "http://example.com/test",
        timestamp: Date.now(),
        deviceId: "test-device-123"
    };
    try {
        await saveHistory(dummyItem);
        ctx.response.body = "Test item saved to history.";
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = `Error saving test item: ${error.message}`;
    }
});


router.get("/", async (ctx) => {
    const indexPath = `${VIEWS_ROOT}/index.ejs`;
    console.log(`[Render Debug] Attempting to render: ${indexPath}`);
    ctx.response.body = await renderFileToString(indexPath);
});

router.get("/status", async (ctx) => {
    const statusPath = `${VIEWS_ROOT}/status.ejs`;
    console.log(`[Render Debug] Attempting to render: ${statusPath}`);
    ctx.response.body = await renderFileToString(statusPath);
});

router.get("/manifesto", async (ctx) => {
    const manifestoPath = `${VIEWS_ROOT}/manifesto.ejs`;
    console.log(`[Render Debug] Attempting to render: ${manifestoPath}`);
    ctx.response.body = await renderFileToString(manifestoPath);
});

router.get("/iletisim", async (ctx) => {
    const iletisimPath = `${VIEWS_ROOT}/contact.ejs`;
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
    const page = ctx.request.url.searchParams.get("page") || "1";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=image&lang=${encodeURIComponent(lang)}&page=${encodeURIComponent(page)}`);
});
router.get("/wiki", (ctx) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const lang = ctx.request.url.searchParams.get("lang") || "tr";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=wiki&lang=${encodeURIComponent(lang)}`);
});
router.get("/video", (ctx) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const lang = ctx.request.url.searchParams.get("lang") || "tr";
    const page = ctx.request.url.searchParams.get("page") || "1";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=video&lang=${encodeURIComponent(lang)}&page=${encodeURIComponent(page)}`);
});
router.get("/news", (ctx) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const lang = ctx.request.url.searchParams.get("lang") || "tr";
    const page = ctx.request.url.searchParams.get("page") || "1";
    ctx.response.redirect(`/search?query=${encodeURIComponent(query)}&type=news&lang=${encodeURIComponent(lang)}&page=${encodeURIComponent(page)}`);
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
            console.warn(`[Static Serve Error] File not found or could not be served: /favicon.ico - ${error.message}`);
            await next();
        }
    } else {
        console.log(`[Static Serve Middleware] Skipping static file send for non-GET request. Passing to next middleware.`);
        await next();
    }
});


console.log("Server started: http://localhost:8000");

updateStatusPeriodically();
setInterval(updateStatusPeriodically, 10000);

await app.listen({ port: 8000 });
