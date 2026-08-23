const fs = require('fs');
const path = require('path');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('community support surfaces', () => {
    test('runtime feedback links use the structured issue chooser', () => {
        const issueChooser = 'https://github.com/Diramain/taskbridge-for-clickup/issues/new/choose';
        expect(source('app/app.html')).toContain(issueChooser);
        expect(source('popup/minimal.html')).toContain(issueChooser);
    });

    test('public issue forms prohibit sensitive data', () => {
        const bugReport = source('.github/ISSUE_TEMPLATE/bug_report.yml');
        const featureRequest = source('.github/ISSUE_TEMPLATE/feature_request.yml');
        for (const template of [bugReport, featureRequest]) {
            expect(template).toContain('no contiene credenciales');
            expect(template).toContain('required: true');
        }
    });

    test('security reports use a private channel instead of public issues', () => {
        expect(source('.github/ISSUE_TEMPLATE/config.yml')).toContain('/security/advisories/new');
        expect(source('SECURITY.md')).toContain('private vulnerability reporting');
        expect(source('SECURITY.md')).toContain('Do not disclose vulnerabilities');
    });
});
