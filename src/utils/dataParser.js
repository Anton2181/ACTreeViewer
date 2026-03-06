import Papa from 'papaparse';

// Google Sheets CSV publish link
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1QpAlKSJKM2RfI47KnTf1M5lF-qBa5e8SrZV0vf1J2UU/export?format=csv&gid=2101836998";

export const fetchAndParseData = async () => {
    try {
        const response = await fetch(SHEET_CSV_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const csvData = await response.text();

        return new Promise((resolve, reject) => {
            Papa.parse(csvData, {
                header: false, // Parse as arrays first to find the real header
                skipEmptyLines: true,
                complete: (results) => {
                    resolve(processParsedData(results.data));
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    } catch (error) {
        console.error("Failed to fetch or parse CSV:", error);
        throw error;
    }
};

const processParsedData = (rawData) => {
    // 1. Find the actual header row ("Character ID")
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        if (rawData[i][0] === 'Character ID') {
            headerRowIndex = i;
            break;
        }
    }

    if (headerRowIndex === -1) {
        console.error("Could not find header row in CSV");
        return [];
    }

    const headers = rawData[headerRowIndex];
    const characters = [];

    // Parse rows below header
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        // Skip empty or invalid rows (no ID or Name)
        if (!row[0] || !row[1] || row[0] === '#N/A') continue;

        const character = {};
        headers.forEach((header, index) => {
            if (header) {
                character[header.trim()] = row[index]?.trim() || '';
            }
        });
        characters.push(character);
    }

    // 2. Build Hierarchy
    // D3 d3-hierarchy typically expects {id, parentId}. 
    // For family trees, a character has a Father and Mother. We will need to normalize this.
    // We'll create a primary id from 'Character ID'.
    const normalizedNodes = characters.map(char => {
        // Find parent IDs based on names (since sheet gives parent names, not IDs)
        // Actually, looking at the sheet, 'Father' and 'Mother' use character names: e.g. 'Aethan Velaryon'
        return {
            ...char,
            id: char['Character ID'],
            // We will resolve actual parent IDs later in the component or here
        };
    });

    return normalizedNodes;
};
