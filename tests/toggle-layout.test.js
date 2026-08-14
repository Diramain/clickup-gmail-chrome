const fs = require('fs');
const path = require('path');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function cssRule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
    expect(match).not.toBeNull();
    return match[1];
}

describe('Automatic tracking toggle layout', () => {
    test('switch track keeps fixed geometry and cannot shrink beside wrapped labels', () => {
        const css = source('popup/popup.css');
        const track = cssRule(css, '.toggle-switch');
        const hiddenInput = cssRule(css, '.toggle-switch input');
        const label = cssRule(css, '.toggle-label');

        expect(track).toMatch(/flex:\s*0 0 48px/);
        expect(track).toMatch(/width:\s*48px/);
        expect(track).toMatch(/min-width:\s*48px/);
        expect(track).toMatch(/max-width:\s*48px/);
        expect(track).toMatch(/height:\s*26px/);
        expect(hiddenInput).toMatch(/position:\s*absolute/);
        expect(hiddenInput).toMatch(/inset:\s*0/);
        expect(hiddenInput).toMatch(/width:\s*100%/);
        expect(hiddenInput).toMatch(/height:\s*100%/);
        expect(hiddenInput).toMatch(/padding:\s*0/);
        expect(label).toMatch(/min-width:\s*0/);
        expect(label).toMatch(/padding-right:\s*12px/);
    });

    test('checked thumb remains inside the 48px track and keyboard focus stays visible', () => {
        const css = source('popup/popup.css');
        const thumb = cssRule(css, '.toggle-slider:before');
        const checkedThumb = cssRule(css, '.toggle-switch input:checked+.toggle-slider:before');

        expect(thumb).toMatch(/width:\s*20px/);
        expect(thumb).toMatch(/left:\s*3px/);
        expect(checkedThumb).toMatch(/translateX\(22px\)/);
        expect(3 + 20 + 22).toBeLessThanOrEqual(48);
        expect(css).toContain('.toggle-switch input:focus-visible+.toggle-slider');
    });

    test('automatic tracking switches have explicit accessible names', () => {
        const html = source('popup/popup.html');

        expect(html).toMatch(/aria-label="Iniciar seguimiento al enfocar una tarea"[\s\S]*id="autoStartToggle"/);
        expect(html).toMatch(/aria-label="Detener al cambiar de tarea o cerrar su última pestaña"[\s\S]*id="autoStopToggle"/);
    });
});
