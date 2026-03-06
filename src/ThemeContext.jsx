import React, { createContext, useState, useContext, useEffect } from 'react';

const ThemeContext = createContext();

export const themes = [
    { id: 'targaryen', name: 'Targaryen Dragon', bg: 'bg-white', textPrimary: 'text-amber-700', textSecondary: 'text-amber-800/80', border: 'border-amber-900/40', hoverBorder: 'hover:border-amber-600/80', hoverShadow: 'hover:shadow-amber-900/20', cardBg: 'bg-amber-50', link: 'stroke-amber-900/40 hover:stroke-amber-500/60' },
    { id: 'stark', name: 'Stark Winter', bg: 'bg-white', textPrimary: 'text-slate-800', textSecondary: 'text-blue-800/80', border: 'border-blue-900/40', hoverBorder: 'hover:border-blue-600/80', hoverShadow: 'hover:shadow-blue-900/20', cardBg: 'bg-slate-50', link: 'stroke-blue-900/40 hover:stroke-blue-600/60' },
    { id: 'lannister', name: 'Lannister Lion', bg: 'bg-white', textPrimary: 'text-red-800', textSecondary: 'text-red-900/80', border: 'border-red-900/40', hoverBorder: 'hover:border-red-600/80', hoverShadow: 'hover:shadow-red-900/20', cardBg: 'bg-red-50', link: 'stroke-red-900/40 hover:stroke-red-600/60' },
    { id: 'tyrell', name: 'Tyrell Rose', bg: 'bg-white', textPrimary: 'text-emerald-800', textSecondary: 'text-emerald-900/80', border: 'border-emerald-900/40', hoverBorder: 'hover:border-emerald-600/80', hoverShadow: 'hover:shadow-emerald-900/20', cardBg: 'bg-emerald-50', link: 'stroke-emerald-900/40 hover:stroke-emerald-600/60' },
];

export const ThemeProvider = ({ children }) => {
    const [currentThemeId, setCurrentThemeId] = useState(() => {
        const saved = localStorage.getItem('asoiaf-theme');
        return saved || 'targaryen';
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
