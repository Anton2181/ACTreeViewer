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

                for (const house of houses) {
                    const sanitizedName = house.replace(/\s+/g, '_');
                    const fileName = `House_${sanitizedName}.svg`;
                    const filePath = path.join(COAS_DIR, fileName);

                    if (fs.existsSync(filePath)) {
                        console.log(`Skipping ${fileName} (already exists)`);
                        continue;
                    }

                    const imgUrl = `https://wappenwiki.org/index.php?title=Special:FilePath/${fileName}`;
                    console.log(`Downloading ${fileName}...`);

                    try {
                        const imgRes = await fetch(imgUrl);
                        if (imgRes.ok) {
                            // verify it's an svg
                            const contentType = imgRes.headers.get('content-type');
                            if (contentType && contentType.includes('image/svg')) {
                                const buffer = await imgRes.arrayBuffer();
                                fs.writeFileSync(filePath, Buffer.from(buffer));
                                console.log(`✓ Saved ${fileName}`);
                            } else {
                                console.log(`✗ ${fileName} not an SVG on WappenWiki, omitting.`);
                            }
                        } else {
                            console.log(`✗ Could not find ${fileName} on WappenWiki (Status: ${imgRes.status})`);
                        }
                    } catch (err) {
                        console.error(`Error downloading ${fileName}:`, err.message);
                    }
                }

                console.log("Finished syncing local Coat of Arms!");
            }
        });

    } catch (e) {
        console.error("Failed to fetch or parse CSV:", e);
    }
}

downloadCoas();
