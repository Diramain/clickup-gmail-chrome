const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: relativePath,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

describe('runtime Spanish and English preference', () => {
    const i18n = loadTsModule('src/i18n.ts');

    beforeEach(() => {
        document.documentElement.innerHTML = `
            <label><span data-i18n="language.label">Idioma</span>
                <select data-language-selector>
                    <option value="es" data-i18n="language.spanish">Español</option>
                    <option value="en" data-i18n="language.english">English</option>
                </select>
            </label>
            <h1 data-i18n="auth.quick">Conexión rápida</h1>
            <input data-i18n-placeholder="meet.titlePlaceholder" placeholder="Nombre de la Meet">
        `;
        i18n.setActiveLanguage('es');
    });

    test('normalizes invalid values to Spanish and safely interpolates catalog copy', () => {
        expect(i18n.normalizeUiLanguage('en')).toBe('en');
        expect(i18n.normalizeUiLanguage('pt')).toBe('es');
        i18n.setActiveLanguage('en');
        expect(i18n.t('meet.destinationType', { destination: 'Product', type: 'Meeting' }))
            .toBe('Destination: Product · Type: Meeting');
    });

    test('translates text, placeholders and document language at runtime', () => {
        i18n.setActiveLanguage('en');
        i18n.translateDocument(document);
        expect(document.documentElement.lang).toBe('en');
        expect(document.querySelector('h1').textContent).toBe('Quick connection');
        expect(document.querySelector('input').placeholder).toBe('Meet name');
    });

    test('persists selector changes through the background contract', async () => {
        const sendMessage = jest.fn().mockResolvedValue({ language: 'en' });
        global.chrome = { runtime: { sendMessage } };
        i18n.bindLanguageSelectors(document);
        const selector = document.querySelector('select');
        selector.value = 'en';
        selector.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sendMessage).toHaveBeenCalledWith({ action: 'setUiLanguage', data: { language: 'en' } });
        expect(document.documentElement.lang).toBe('en');
        delete global.chrome;
    });

    test('message schema accepts only es or en from trusted extension pages', () => {
        const securitySource = source('src/message-security.ts');
        const background = source('background.ts');
        expect(securitySource).toContain("['es', 'en'].includes(data.language)");
        expect(background).toContain('UI_LANGUAGE_STORAGE_KEY');
        expect(background).toMatch(/case 'getUiLanguage':[\s\S]{0,240}normalizeUiLanguage/);
        expect(background).toMatch(/case 'setUiLanguage':[\s\S]{0,240}chrome\.storage\.local\.set/);
    });
});
