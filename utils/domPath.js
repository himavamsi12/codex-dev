// Ported from responsive-viewer-master/src/utils/domPath.ts
export function getDomPath(el) {
    const stack = [];

    while (el.parentElement != null) {
        let sibCount = 0;
        let sibIndex = 0;
        for (let i = 0; i < el.parentElement.childNodes.length; i++) {
            let sib = el.parentElement.childNodes[i];
            if (sib.nodeName === el.nodeName) {
                if (sib === el) {
                    sibIndex = sibCount;
                }
                sibCount++;
            }
        }
        if (el.hasAttribute('id') && el.id !== '') {
            stack.unshift(el.nodeName.toLowerCase() + '#' + el.id);
        } else if (sibCount > 1) {
            stack.unshift(el.nodeName.toLowerCase() + ':eq(' + sibIndex + ')');
        } else {
            stack.unshift(el.nodeName.toLowerCase());
        }
        el = el.parentElement;
    }

    return stack;
}

export default function domPath(element) {
    return getDomPath(element).join(' > ');
}
