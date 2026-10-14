import { createTheme } from '@mantine/core';

export const theme = createTheme({
    fontFamily: 'Montserrat, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
    fontFamilyMonospace: 'JetBrains Mono, Fira Mono, ui-monospace, monospace',
    cursorType: 'pointer',
    focusRing: 'never',
    primaryColor: 'cyan',
    primaryShade: 8,
    defaultRadius: 'md',
    autoContrast: true,
    colors: {
        dark: ['#c9d1d9', '#b1bac4', '#8b949e', '#6e7681', '#484f58', '#30363d', '#21262d', '#161b22', '#0d1117', '#010409'],
    },
    headings: { fontWeight: '600' },
});
