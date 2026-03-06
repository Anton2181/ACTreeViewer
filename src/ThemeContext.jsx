import React, { createContext, useState, useContext, useEffect } from 'react';

const ThemeContext = createContext();

export const themes = [
    { id: 'stark', name: 'Stark Winter', bg: 'bg-white', textPrimary: 'text-slate-800', textSecondary: 'text-blue-800/80', border: 'border-blue-900/40', hoverBorder: 'hover:border-blue-600/80', hoverShadow: 'hover:shadow-blue-900/20', cardBg: 'bg-slate-50', link: 'stroke-blue-900/40 hover:stroke-blue-600/60' },
];

export const ThemeProvider = ({ children }) => {
    const [currentThemeId, setCurrentThemeId] = useState(() => {
        const saved = localStorage.getItem('asoiaf-theme');
        return saved || 'stark';
    });

    const [theme, setThemeObj] = useState(
        themes.find(t => t.id === currentThemeId) || themes[0]
    );

    useEffect(() => {
        localStorage.setItem('asoiaf-theme', currentThemeId);
        setThemeObj(themes.find(t => t.id === currentThemeId) || themes[0]);
    }, [currentThemeId]);

    return (
        <ThemeContext.Provider value={{ theme, currentThemeId, setCurrentThemeId, allThemes: themes }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
