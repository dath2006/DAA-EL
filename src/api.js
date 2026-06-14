const highWayExclude = ["footway", "street_lamp", "steps", "pedestrian", "track", "path"];

const OVERPASS_ENDPOINTS = [
    "http://localhost/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
];

// Cache to store successful Overpass API responses
const responseCache = new Map();

/**
 * Fetches OpenStreetMap network data from Overpass API.
 * Uses a list of public mirrors with an 8-second timeout fallback.
 * @param {Array} boundingBox array with 2 objects that have a latitude and longitude property 
 * @returns {Promise<Response>}
 */
export async function fetchOverpassData(boundingBox) {
    const exclusion = highWayExclude.map(e => `[highway!="${e}"]`).join("");
    const query = `
    [out:json];(
        way[highway]${exclusion}[footway!="*"]
        (${boundingBox[0].latitude},${boundingBox[0].longitude},${boundingBox[1].latitude},${boundingBox[1].longitude});
        node(w);
    );
    out skel;`;

    // Try cache hit first
    const cacheKey = JSON.stringify(boundingBox);
    if (responseCache.has(cacheKey)) {
        console.log("Returning cached Overpass response.");
        return responseCache.get(cacheKey).clone();
    }

    let lastError = null;

    for (const endpoint of OVERPASS_ENDPOINTS) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds timeout per server

        try {
            console.log(`Attempting to fetch Overpass data from: ${endpoint}`);
            const response = await fetch(endpoint, {
                method: "POST",
                body: query,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                // Cache the response clone
                responseCache.set(cacheKey, response.clone());
                return response;
            }
            console.warn(`Overpass server ${endpoint} returned status ${response.status}: ${response.statusText}`);
            lastError = new Error(`Server returned ${response.status}: ${response.statusText}`);
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError") {
                console.warn(`Overpass server ${endpoint} request timed out after 8 seconds.`);
                lastError = new Error("Server request timed out after 8 seconds");
            } else {
                console.error(`Failed to fetch from Overpass server ${endpoint}:`, error);
                lastError = error;
            }
        }
    }

    throw lastError || new Error("All Overpass servers failed");
}