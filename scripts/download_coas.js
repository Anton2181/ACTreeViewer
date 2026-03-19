import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Google Sheets CSV publish link
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1WKSeqB1yX91A2TyD9Lie-mwNkc4qLIrN-pIPbX2knac/export?format=csv&gid=0";
const COAS_DIR = path.join(__dirname, '../public/coas');

async function downloadCoas() {
    console.log("Fetching character data...");
    try {
        const response = await fetch(SHEET_CSV_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const csvData = await response.text();

        Papa.parse(csvData, {
            header: false,
            skipEmptyLines: true,
            complete: async (results) => {
                const rawData = results.data;
                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(20, rawData.length); i++) {
                    if (rawData[i][0] === 'Character ID (numeric)' || rawData[i][0] === 'Character ID') {
                        headerRowIndex = i;
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    console.error("Could not find header row in CSV");
                    return;
                }

                const headers = rawData[headerRowIndex];
                const houseIndex = headers.indexOf('House');

                if (houseIndex === -1) {
                    console.error("Could not find 'House' column");
                    return;
                }

                const houses = new Set();
                for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                    const house = rawData[i][houseIndex]?.trim();
                    if (house) houses.add(house);
                }

                console.log(`Found ${houses.size} unique houses. Ensuring public/coas directory exists...`);
                if (!fs.existsSync(COAS_DIR)) {
                    fs.mkdirSync(COAS_DIR, { recursive: true });
                }

                const missingHouses = [];

                for (const house of houses) {
                    const sanitizedName = house.replace(/\s+/g, '_');
                    const svgFileName = `House_${sanitizedName}.svg`;
                    const pngFileName = `House_${sanitizedName}.png`;
                    
                    const svgPath = path.join(COAS_DIR, svgFileName);
                    const pngPath = path.join(COAS_DIR, pngFileName);

                    if (fs.existsSync(svgPath) || fs.existsSync(pngPath)) {
                        console.log(`Skipping ${house} (already exists as SVG or PNG)`);
                        continue;
                    }

                    const imgUrl = `https://wappenwiki.org/index.php?title=Special:FilePath/${svgFileName}`;
                    console.log(`Downloading ${svgFileName}...`);

                    try {
                        const imgRes = await fetch(imgUrl);
                        if (imgRes.ok) {
                            // verify it's an svg
                            const contentType = imgRes.headers.get('content-type');
                            if (contentType && contentType.includes('image/svg')) {
                                const buffer = await imgRes.arrayBuffer();
                                fs.writeFileSync(svgPath, Buffer.from(buffer));
                                console.log(`✓ Saved ${svgFileName}`);
                            } else {
                                console.log(`✗ ${svgFileName} not an SVG on WappenWiki, omitting.`);
                                missingHouses.push(house);
                            }
                        } else {
                            console.log(`✗ Could not find ${svgFileName} on WappenWiki (Status: ${imgRes.status})`);
                            missingHouses.push(house);
                        }
                    } catch (err) {
                        console.error(`Error downloading ${svgFileName}:`, err.message);
                        missingHouses.push(house);
                    }
                }

                console.log("\nFinished syncing local Coat of Arms!");
                if (missingHouses.length > 0) {
                    console.log("\n--- MISSING COATS OF ARMS ---");
                    console.log(missingHouses.sort().join('\n'));
                    console.log(`Total missing: ${missingHouses.length}`);
                } else {
                    console.log("All house coats of arms found!");
                }
            }
        });

    } catch (e) {
        console.error("Failed to fetch or parse CSV:", e);
    }
}

downloadCoas();
