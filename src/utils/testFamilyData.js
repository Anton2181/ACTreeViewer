const TEST_FAMILY_CHARACTERS = [
    {
        'Character ID (numeric)': '9001',
        'First Name': 'Lord Rowan',
        House: 'House Testwell',
        Sex: 'Male',
        'Year of Birth': '40',
        Claim: 'Test Patriarch',
        'Father (ID)': '',
        'Mother (ID)': ''
    },
    {
        'Character ID (numeric)': '9002',
        'First Name': 'Lady Elinor',
        House: 'House Testwell',
        Sex: 'Female',
        'Year of Birth': '42',
        Claim: 'First Wife',
        'Father (ID)': '',
        'Mother (ID)': ''
    },
    {
        'Character ID (numeric)': '9003',
        'First Name': 'Lady Marga',
        House: 'House Rivers',
        Sex: 'Female',
        'Year of Birth': '45',
        Claim: 'Second Wife',
        'Father (ID)': '',
        'Mother (ID)': ''
    },
    {
        'Character ID (numeric)': '9004',
        'First Name': 'Ser Alaric',
        House: 'House Testwell',
        Sex: 'Male',
        'Year of Birth': '65',
        Claim: 'Legitimate Son',
        'Father (ID)': '9001',
        'Mother (ID)': '9002'
    },
    {
        'Character ID (numeric)': '9005',
        'First Name': 'Lady Betha',
        House: 'House Testwell',
        Sex: 'Female',
        'Year of Birth': '68',
        Claim: 'Legitimate Daughter',
        'Father (ID)': '9001',
        'Mother (ID)': '9002'
    },
    {
        'Character ID (numeric)': '9006',
        'First Name': 'Jon Waters',
        House: 'House Waters',
        Sex: 'Male',
        'Year of Birth': '70',
        Claim: 'Bastard Son',
        'Father (ID)': '9001',
        'Mother (ID)': '9003'
    },
    {
        'Character ID (numeric)': '9007',
        'First Name': 'Lady Serra',
        House: 'House Reed',
        Sex: 'Female',
        'Year of Birth': '43',
        Claim: 'First Husband',
        'Father (ID)': '',
        'Mother (ID)': ''
    },
    {
        'Character ID (numeric)': '9008',
        'First Name': 'Lady Alys',
        House: 'House Reed',
        Sex: 'Female',
        'Year of Birth': '66',
        Claim: 'Daughter by First Husband',
        'Father (ID)': '9007',
        'Mother (ID)': '9003'
    },
    {
        'Character ID (numeric)': '9009',
        'First Name': 'Lady Myrielle',
        House: 'House Vale',
        Sex: 'Female',
        'Year of Birth': '71',
        Claim: 'Mother-Known Bastard',
        'Father (ID)': '',
        'Mother (ID)': '9003'
    },
    {
        'Character ID (numeric)': '9010',
        'First Name': 'Ser Corwyn',
        House: 'House Testwell',
        Sex: 'Male',
        'Year of Birth': '67',
        Claim: 'Son of Alaric',
        'Father (ID)': '9004',
        'Mother (ID)': '9008'
    },
    {
        'Character ID (numeric)': '9011',
        'First Name': 'Lady Cyrene',
        House: 'House Reed',
        Sex: 'Female',
        'Year of Birth': '69',
        Claim: 'Daughter of Alaric',
        'Father (ID)': '9004',
        'Mother (ID)': '9008'
    },
    {
        'Character ID (numeric)': '9012',
        'First Name': 'Mya Stone',
        House: 'House Stone',
        Sex: 'Female',
        'Year of Birth': '74',
        Claim: 'Father-Known Bastard',
        'Father (ID)': '9004',
        'Mother (ID)': ''
    }
];

export const buildTestFamilyCharacters = () => TEST_FAMILY_CHARACTERS.map((char) => ({
    ...char,
    id: char['Character ID (numeric)'],
    FatherId: char['Father (ID)'],
    MotherId: char['Mother (ID)']
}));
