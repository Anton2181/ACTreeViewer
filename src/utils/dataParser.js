import Papa from 'papaparse';

// Google Sheets CSV publish link
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1WKSeqB1yX91A2TyD9Lie-mwNkc4qLIrN-pIPbX2knac/export?format=csv&gid=0";

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
                    const rawData = results.data;
                    let currentYear = "94 DV";
                    if (rawData.length > 0 && rawData[0][0] === 'Current Year:') {
                        currentYear = rawData[0][1];
                    }
                    resolve({
                        year: currentYear,
                        characters: processParsedData(rawData)
                    });
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
    // 1. Find the actual header row ("Character ID (numeric)")
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        if (rawData[i][0] === 'Character ID (numeric)' || rawData[i][0] === 'Character ID') {
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
    const normalizedNodes = characters.map(char => {
        return {
            ...char,
            id: char['Character ID (numeric)'] || char['Character ID'],
            FatherId: char['Father (ID)'],
            MotherId: char['Mother (ID)']
        };
    });

    return normalizedNodes;
};
