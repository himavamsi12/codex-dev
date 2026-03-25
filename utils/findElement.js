// Ported from responsive-viewer-master/src/utils/findElement.ts

export const findWrappingSvg = (element) => {
    if (!element) {
        return null;
    }
    if (element.tagName === 'svg') {
        return element;
    }

    if (element !== document.body && element.parentElement) {
        return findWrappingSvg(element.parentElement);
    }

    return null;
};

export const splitPath = (path) => {
    const splitByDotRegexUsingEq = /(:eq\(.*?\))/gi;

    return path
        .trim()
        .split(splitByDotRegexUsingEq)
        .map(r => {
            if (r.startsWith(':eq')) {
                const match = r.match(/([0-9])/g);
                if (!match) {
                    return 0;
                }
                return parseInt(match.join(''));
            }
            r = r.trim();
            if (r.startsWith('>')) {
                r = `:scope ${r}`;
            }
            return r;
        })
        .filter(r => r !== '');
};

export default function findElement(path) {
    const paths = splitPath(path);

    let element = document.documentElement;

    while (paths.length > 0) {
        const path = paths.shift();
        let index = 0;
        if (typeof paths[0] === 'number') {
            index = paths.shift();
        }

        if (typeof path === 'string') {
            if (index > 0) {
                const found = element.querySelectorAll(path);
                element = found[index];
            } else {
                element = element.querySelector(path);
            }
        }

        if (!element) {
            return null;
        }
    }

    if (!element) {
        return;
    }

    const wrappingSvg = findWrappingSvg(element);

    if (wrappingSvg) {
        return wrappingSvg.parentElement || wrappingSvg;
    }

    return element;
}
