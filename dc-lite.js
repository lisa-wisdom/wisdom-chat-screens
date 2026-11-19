/*
 * dc-lite.js: a tiny runtime that renders a design-component template
 * (<template id="dc-template">) with its logic class (<script type="text/x-dc">)
 * using React. It supports {{hole}} lookups, <sc-for>, <sc-if>, event
 * handlers (onClick, onMouseEnter, …) and ref callbacks.
 */
(function () {
  'use strict';
  var R = window.React;
  var RD = window.ReactDOM;

  function DCLogic(props) { R.Component.call(this, props); }
  DCLogic.prototype = Object.create(R.Component.prototype);
  DCLogic.prototype.constructor = DCLogic;
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/;

  function lookup(scope, path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function interp(str, scope) {
    var m = str.match(WHOLE);
    if (m) return lookup(scope, m[1]);
    return str.replace(HOLE, function (_, p) {
      var v = lookup(scope, p);
      return v == null ? '' : String(v);
    });
  }

  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function parseStyle(str) {
    var out = {};
    var depth = 0, cur = '', parts = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    parts.forEach(function (decl) {
      var idx = decl.indexOf(':');
      if (idx < 0) return;
      var k = decl.slice(0, idx).trim();
      var v = decl.slice(idx + 1).trim();
      if (!k) return;
      out[k.indexOf('--') === 0 ? k : camel(k)] = v;
    });
    return out;
  }

  var EVENTS = {
    onclick: 'onClick', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave',
    onfocus: 'onFocus', onblur: 'onBlur', onchange: 'onChange', oninput: 'onInput',
    onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onmousemove: 'onMouseMove',
    onmousedown: 'onMouseDown', onmouseup: 'onMouseUp', onsubmit: 'onSubmit'
  };
  var RENAME = {
    'class': 'className', 'for': 'htmlFor', tabindex: 'tabIndex', colspan: 'colSpan',
    rowspan: 'rowSpan', maxlength: 'maxLength', readonly: 'readOnly', autocomplete: 'autoComplete',
    crossorigin: 'crossOrigin', srcset: 'srcSet', contenteditable: 'contentEditable', spellcheck: 'spellCheck',
    'xlink:href': 'xlinkHref'
  };

  function propsFor(el, scope, key) {
    var props = { key: key };
    var tag = el.tagName.toLowerCase();
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      var name = a.name;
      if (name.indexOf('hint-') === 0) continue;
      // SVG geometry attributes are stored as dc-<name> so the browser doesn't
      // try to parse the {{hole}} text as a length or path.
      if (name.indexOf('dc-') === 0) { name = name.slice(3); if (name === 'viewbox') name = 'viewBox'; }
      var val = interp(a.value, scope);
      var lname = name.toLowerCase();
      if (EVENTS[lname]) { if (typeof val === 'function') props[EVENTS[lname]] = val; continue; }
      if (lname === 'ref') { if (val) props.ref = val; continue; }
      if (lname === 'style') { props.style = parseStyle(val == null ? '' : String(val)); continue; }
      if (RENAME[lname]) { props[RENAME[lname]] = val; continue; }
      if (lname === 'value' && (tag === 'input' || tag === 'textarea')) { props.defaultValue = val; continue; }
      if (lname.indexOf('aria-') === 0 || lname.indexOf('data-') === 0) {
        props[lname] = typeof val === 'boolean' ? String(val) : val; continue;
      }
      if (name.indexOf('-') > 0) { props[camel(name)] = val; continue; }
      if (a.value === '' && (lname === 'hidden' || lname === 'disabled' || lname === 'checked')) { props[lname] = true; continue; }
      props[name] = val;
    }
    return props;
  }

  function child(scope, extra) {
    var s = Object.create(scope);
    for (var k in extra) s[k] = extra[k];
    return s;
  }

  function build(nodes, scope, keyBase) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var key = keyBase + '.' + i;
      if (n.nodeType === 3) {
        var t = n.nodeValue;
        if (t.indexOf('{{') < 0) { out.push(t); continue; }
        var v = interp(t, scope);
        out.push(v == null ? '' : (typeof v === 'object' ? '' : String(v)));
        continue;
      }
      if (n.nodeType !== 1) continue;
      var tag = n.tagName.toLowerCase();
      if (tag === 'helmet') continue;
      if (tag === 'sc-if') {
        if (interp(n.getAttribute('value') || '', scope)) {
          out.push(R.createElement(R.Fragment, { key: key }, build(n.childNodes, scope, key)));
        }
        continue;
      }
      if (tag === 'sc-for') {
        var list = interp(n.getAttribute('list') || '', scope) || [];
        var as = n.getAttribute('as') || 'item';
        var kids = [];
        for (var j = 0; j < list.length; j++) {
          var extra = { $index: j };
          extra[as] = list[j];
          kids.push(R.createElement(R.Fragment, { key: key + ':' + j }, build(n.childNodes, child(scope, extra), key + ':' + j)));
        }
        out.push(R.createElement(R.Fragment, { key: key }, kids));
        continue;
      }
      var kidsArr = build(n.childNodes, scope, key);
      out.push(R.createElement.apply(null, [tag, propsFor(n, scope, key)].concat(kidsArr.length ? kidsArr : [])));
    }
    return out;
  }

  function boot() {
    var tpl = document.getElementById('dc-template');
    var code = document.querySelector('script[type="text/x-dc"]');
    var nodes = tpl.content.childNodes;
    var Logic = new Function('DCLogic', code.textContent + '\nreturn Component;')(DCLogic);
    var Host = (function (Base) {
      return class extends Base {
        render() {
          var vals = this.renderVals ? this.renderVals() : {};
          return R.createElement(R.Fragment, null, build(nodes, vals, 'r'));
        }
      };
    })(Logic);
    RD.createRoot(document.getElementById('dc-root')).render(R.createElement(Host, {}));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
