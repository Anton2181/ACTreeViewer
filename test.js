import { fetchAndParseData } from './src/utils/dataParser.js';
fetchAndParseData().then(data => console.log(data[0])).catch(console.error);
