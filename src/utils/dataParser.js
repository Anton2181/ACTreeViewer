import Papa from 'papaparse';
import { buildTestFamilyCharacters } from './testFamilyData';

// Google Sheets CSV publish links
const CHARACTER_SHEET_URL = "https://docs.google.com/spreadsheets/d/1WKSeqB1yX91A2TyD9Lie-mwNkc4qLIrN-pIPbX2knac/export?format=csv&gid=0";
const YEAR_SHEET_URL = "https://docs.google.com/spreadsheets/d/1QpAlKSJKM2RfI47KnTf1M5lF-qBa5e8SrZV0vf1J2UU/export?format=csv&gid=2101836998";

export const fetchAndParseData = async () => {
    try {
        const [charResponse, yearResponse] = await Promise.all([
            fetch(CHARACTER_SHEET_URL),
            fetch(YEAR_SHEET_URL)
        ]);

        if (!charResponse.ok) throw new Error(`Char HTTP error! status: ${charResponse.status}`);
        if (!yearResponse.ok) throw new Error(`Year HTTP error! status: ${yearResponse.status}`);

        const [csvData, yearCsvData] = await Promise.all([
            charResponse.text(),
            yearResponse.text()
        ]);

        return new Promise((resolve, reject) => {
            // 1. Parse Year first (it's simpler)
            const yearResults = Papa.parse(yearCsvData, { header: false, skipEmptyLines: true });
            let currentYear = "94 DV";
            if (yearResults.data.length > 0) {
                // Cell B1 is row 0, index 1
                currentYear = yearResults.data[0][1] || currentYear;
            }

            // 2. Parse Characters
            Papa.parse(csvData, {
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    resolve({
                        year: currentYear,
                        characters: [
                            ...processParsedData(results.data),
                            ...(import.meta.env.DEV ? buildTestFamilyCharacters() : [])
                        ]
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
