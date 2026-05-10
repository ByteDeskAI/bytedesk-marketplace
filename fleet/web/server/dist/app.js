// node_modules/preact/dist/preact.module.js
var n;
var l;
var u;
var t;
var i;
var r;
var o;
var e;
var f;
var c;
var s;
var a;
var h;
var p;
var v;
var y;
var d = {};
var w = [];
var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var g = Array.isArray;
function m(n2, l3) {
  for (var u4 in l3) n2[u4] = l3[u4];
  return n2;
}
function b(n2) {
  n2 && n2.parentNode && n2.parentNode.removeChild(n2);
}
function k(l3, u4, t3) {
  var i4, r3, o3, e3 = {};
  for (o3 in u4) "key" == o3 ? i4 = u4[o3] : "ref" == o3 ? r3 = u4[o3] : e3[o3] = u4[o3];
  if (arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t3), "function" == typeof l3 && null != l3.defaultProps) for (o3 in l3.defaultProps) void 0 === e3[o3] && (e3[o3] = l3.defaultProps[o3]);
  return x(l3, e3, i4, r3, null);
}
function x(n2, t3, i4, r3, o3) {
  var e3 = { type: n2, props: t3, key: i4, ref: r3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o3 ? ++u : o3, __i: -1, __u: 0 };
  return null == o3 && null != l.vnode && l.vnode(e3), e3;
}
function S(n2) {
  return n2.children;
}
function C(n2, l3) {
  this.props = n2, this.context = l3;
}
function $(n2, l3) {
  if (null == l3) return n2.__ ? $(n2.__, n2.__i + 1) : null;
  for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
  return "function" == typeof n2.type ? $(n2) : null;
}
function I(n2) {
  if (n2.__P && n2.__d) {
    var u4 = n2.__v, t3 = u4.__e, i4 = [], r3 = [], o3 = m({}, u4);
    o3.__v = u4.__v + 1, l.vnode && l.vnode(o3), q(n2.__P, o3, u4, n2.__n, n2.__P.namespaceURI, 32 & u4.__u ? [t3] : null, i4, null == t3 ? $(u4) : t3, !!(32 & u4.__u), r3), o3.__v = u4.__v, o3.__.__k[o3.__i] = o3, D(i4, o3, r3), u4.__e = u4.__ = null, o3.__e != t3 && P(o3);
  }
}
function P(n2) {
  if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l3) {
    if (null != l3 && null != l3.__e) return n2.__e = n2.__c.base = l3.__e;
  }), P(n2);
}
function A(n2) {
  (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
}
function H() {
  try {
    for (var n2, l3 = 1; i.length; ) i.length > l3 && i.sort(e), n2 = i.shift(), l3 = i.length, I(n2);
  } finally {
    i.length = H.__r = 0;
  }
}
function L(n2, l3, u4, t3, i4, r3, o3, e3, f4, c3, s3) {
  var a3, h3, p3, v3, y3, _2, g2, m3 = t3 && t3.__k || w, b2 = l3.length;
  for (f4 = T(u4, l3, m3, f4, b2), a3 = 0; a3 < b2; a3++) null != (p3 = u4.__k[a3]) && (h3 = -1 != p3.__i && m3[p3.__i] || d, p3.__i = a3, _2 = q(n2, p3, h3, i4, r3, o3, e3, f4, c3, s3), v3 = p3.__e, p3.ref && h3.ref != p3.ref && (h3.ref && J(h3.ref, null, p3), s3.push(p3.ref, p3.__c || v3, p3)), null == y3 && null != v3 && (y3 = v3), (g2 = !!(4 & p3.__u)) || h3.__k === p3.__k ? (f4 = j(p3, f4, n2, g2), g2 && h3.__e && (h3.__e = null)) : "function" == typeof p3.type && void 0 !== _2 ? f4 = _2 : v3 && (f4 = v3.nextSibling), p3.__u &= -7);
  return u4.__e = y3, f4;
}
function T(n2, l3, u4, t3, i4) {
  var r3, o3, e3, f4, c3, s3 = u4.length, a3 = s3, h3 = 0;
  for (n2.__k = new Array(i4), r3 = 0; r3 < i4; r3++) null != (o3 = l3[r3]) && "boolean" != typeof o3 && "function" != typeof o3 ? ("string" == typeof o3 || "number" == typeof o3 || "bigint" == typeof o3 || o3.constructor == String ? o3 = n2.__k[r3] = x(null, o3, null, null, null) : g(o3) ? o3 = n2.__k[r3] = x(S, { children: o3 }, null, null, null) : void 0 === o3.constructor && o3.__b > 0 ? o3 = n2.__k[r3] = x(o3.type, o3.props, o3.key, o3.ref ? o3.ref : null, o3.__v) : n2.__k[r3] = o3, f4 = r3 + h3, o3.__ = n2, o3.__b = n2.__b + 1, e3 = null, -1 != (c3 = o3.__i = O(o3, u4, f4, a3)) && (a3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i4 > s3 ? h3-- : i4 < s3 && h3++), "function" != typeof o3.type && (o3.__u |= 4)) : c3 != f4 && (c3 == f4 - 1 ? h3-- : c3 == f4 + 1 ? h3++ : (c3 > f4 ? h3-- : h3++, o3.__u |= 4))) : n2.__k[r3] = null;
  if (a3) for (r3 = 0; r3 < s3; r3++) null != (e3 = u4[r3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = $(e3)), K(e3, e3));
  return t3;
}
function j(n2, l3, u4, t3) {
  var i4, r3;
  if ("function" == typeof n2.type) {
    for (i4 = n2.__k, r3 = 0; i4 && r3 < i4.length; r3++) i4[r3] && (i4[r3].__ = n2, l3 = j(i4[r3], l3, u4, t3));
    return l3;
  }
  n2.__e != l3 && (t3 && (l3 && n2.type && !l3.parentNode && (l3 = $(n2)), u4.insertBefore(n2.__e, l3 || null)), l3 = n2.__e);
  do {
    l3 = l3 && l3.nextSibling;
  } while (null != l3 && 8 == l3.nodeType);
  return l3;
}
function O(n2, l3, u4, t3) {
  var i4, r3, o3, e3 = n2.key, f4 = n2.type, c3 = l3[u4], s3 = null != c3 && 0 == (2 & c3.__u);
  if (null === c3 && null == e3 || s3 && e3 == c3.key && f4 == c3.type) return u4;
  if (t3 > (s3 ? 1 : 0)) {
    for (i4 = u4 - 1, r3 = u4 + 1; i4 >= 0 || r3 < l3.length; ) if (null != (c3 = l3[o3 = i4 >= 0 ? i4-- : r3++]) && 0 == (2 & c3.__u) && e3 == c3.key && f4 == c3.type) return o3;
  }
  return -1;
}
function z(n2, l3, u4) {
  "-" == l3[0] ? n2.setProperty(l3, null == u4 ? "" : u4) : n2[l3] = null == u4 ? "" : "number" != typeof u4 || _.test(l3) ? u4 : u4 + "px";
}
function N(n2, l3, u4, t3, i4) {
  var r3, o3;
  n: if ("style" == l3) if ("string" == typeof u4) n2.style.cssText = u4;
  else {
    if ("string" == typeof t3 && (n2.style.cssText = t3 = ""), t3) for (l3 in t3) u4 && l3 in u4 || z(n2.style, l3, "");
    if (u4) for (l3 in u4) t3 && u4[l3] == t3[l3] || z(n2.style, l3, u4[l3]);
  }
  else if ("o" == l3[0] && "n" == l3[1]) r3 = l3 != (l3 = l3.replace(a, "$1")), o3 = l3.toLowerCase(), l3 = o3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? o3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + r3] = u4, u4 ? t3 ? u4[s] = t3[s] : (u4[s] = h, n2.addEventListener(l3, r3 ? v : p, r3)) : n2.removeEventListener(l3, r3 ? v : p, r3);
  else {
    if ("http://www.w3.org/2000/svg" == i4) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
    else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
      n2[l3] = null == u4 ? "" : u4;
      break n;
    } catch (n3) {
    }
    "function" == typeof u4 || (null == u4 || false === u4 && "-" != l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u4 ? "" : u4));
  }
}
function V(n2) {
  return function(u4) {
    if (this.l) {
      var t3 = this.l[u4.type + n2];
      if (null == u4[c]) u4[c] = h++;
      else if (u4[c] < t3[s]) return;
      return t3(l.event ? l.event(u4) : u4);
    }
  };
}
function q(n2, u4, t3, i4, r3, o3, e3, f4, c3, s3) {
  var a3, h3, p3, v3, y3, d3, _2, k3, x2, M, $2, I2, P2, A3, H2, T3 = u4.type;
  if (void 0 !== u4.constructor) return null;
  128 & t3.__u && (c3 = !!(32 & t3.__u), o3 = [f4 = u4.__e = t3.__e]), (a3 = l.__b) && a3(u4);
  n: if ("function" == typeof T3) try {
    if (k3 = u4.props, x2 = T3.prototype && T3.prototype.render, M = (a3 = T3.contextType) && i4[a3.__c], $2 = a3 ? M ? M.props.value : a3.__ : i4, t3.__c ? _2 = (h3 = u4.__c = t3.__c).__ = h3.__E : (x2 ? u4.__c = h3 = new T3(k3, $2) : (u4.__c = h3 = new C(k3, $2), h3.constructor = T3, h3.render = Q), M && M.sub(h3), h3.state || (h3.state = {}), h3.__n = i4, p3 = h3.__d = true, h3.__h = [], h3._sb = []), x2 && null == h3.__s && (h3.__s = h3.state), x2 && null != T3.getDerivedStateFromProps && (h3.__s == h3.state && (h3.__s = m({}, h3.__s)), m(h3.__s, T3.getDerivedStateFromProps(k3, h3.__s))), v3 = h3.props, y3 = h3.state, h3.__v = u4, p3) x2 && null == T3.getDerivedStateFromProps && null != h3.componentWillMount && h3.componentWillMount(), x2 && null != h3.componentDidMount && h3.__h.push(h3.componentDidMount);
    else {
      if (x2 && null == T3.getDerivedStateFromProps && k3 !== v3 && null != h3.componentWillReceiveProps && h3.componentWillReceiveProps(k3, $2), u4.__v == t3.__v || !h3.__e && null != h3.shouldComponentUpdate && false === h3.shouldComponentUpdate(k3, h3.__s, $2)) {
        u4.__v != t3.__v && (h3.props = k3, h3.state = h3.__s, h3.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
          n3 && (n3.__ = u4);
        }), w.push.apply(h3.__h, h3._sb), h3._sb = [], h3.__h.length && e3.push(h3);
        break n;
      }
      null != h3.componentWillUpdate && h3.componentWillUpdate(k3, h3.__s, $2), x2 && null != h3.componentDidUpdate && h3.__h.push(function() {
        h3.componentDidUpdate(v3, y3, d3);
      });
    }
    if (h3.context = $2, h3.props = k3, h3.__P = n2, h3.__e = false, I2 = l.__r, P2 = 0, x2) h3.state = h3.__s, h3.__d = false, I2 && I2(u4), a3 = h3.render(h3.props, h3.state, h3.context), w.push.apply(h3.__h, h3._sb), h3._sb = [];
    else do {
      h3.__d = false, I2 && I2(u4), a3 = h3.render(h3.props, h3.state, h3.context), h3.state = h3.__s;
    } while (h3.__d && ++P2 < 25);
    h3.state = h3.__s, null != h3.getChildContext && (i4 = m(m({}, i4), h3.getChildContext())), x2 && !p3 && null != h3.getSnapshotBeforeUpdate && (d3 = h3.getSnapshotBeforeUpdate(v3, y3)), A3 = null != a3 && a3.type === S && null == a3.key ? E(a3.props.children) : a3, f4 = L(n2, g(A3) ? A3 : [A3], u4, t3, i4, r3, o3, e3, f4, c3, s3), h3.base = u4.__e, u4.__u &= -161, h3.__h.length && e3.push(h3), _2 && (h3.__E = h3.__ = null);
  } catch (n3) {
    if (u4.__v = null, c3 || null != o3) if (n3.then) {
      for (u4.__u |= c3 ? 160 : 128; f4 && 8 == f4.nodeType && f4.nextSibling; ) f4 = f4.nextSibling;
      o3[o3.indexOf(f4)] = null, u4.__e = f4;
    } else {
      for (H2 = o3.length; H2--; ) b(o3[H2]);
      B(u4);
    }
    else u4.__e = t3.__e, u4.__k = t3.__k, n3.then || B(u4);
    l.__e(n3, u4, t3);
  }
  else null == o3 && u4.__v == t3.__v ? (u4.__k = t3.__k, u4.__e = t3.__e) : f4 = u4.__e = G(t3.__e, u4, t3, i4, r3, o3, e3, c3, s3);
  return (a3 = l.diffed) && a3(u4), 128 & u4.__u ? void 0 : f4;
}
function B(n2) {
  n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
}
function D(n2, u4, t3) {
  for (var i4 = 0; i4 < t3.length; i4++) J(t3[i4], t3[++i4], t3[++i4]);
  l.__c && l.__c(u4, n2), n2.some(function(u5) {
    try {
      n2 = u5.__h, u5.__h = [], n2.some(function(n3) {
        n3.call(u5);
      });
    } catch (n3) {
      l.__e(n3, u5.__v);
    }
  });
}
function E(n2) {
  return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : m({}, n2);
}
function G(u4, t3, i4, r3, o3, e3, f4, c3, s3) {
  var a3, h3, p3, v3, y3, w3, _2, m3 = i4.props || d, k3 = t3.props, x2 = t3.type;
  if ("svg" == x2 ? o3 = "http://www.w3.org/2000/svg" : "math" == x2 ? o3 = "http://www.w3.org/1998/Math/MathML" : o3 || (o3 = "http://www.w3.org/1999/xhtml"), null != e3) {
    for (a3 = 0; a3 < e3.length; a3++) if ((y3 = e3[a3]) && "setAttribute" in y3 == !!x2 && (x2 ? y3.localName == x2 : 3 == y3.nodeType)) {
      u4 = y3, e3[a3] = null;
      break;
    }
  }
  if (null == u4) {
    if (null == x2) return document.createTextNode(k3);
    u4 = document.createElementNS(o3, x2, k3.is && k3), c3 && (l.__m && l.__m(t3, e3), c3 = false), e3 = null;
  }
  if (null == x2) m3 === k3 || c3 && u4.data == k3 || (u4.data = k3);
  else {
    if (e3 = e3 && n.call(u4.childNodes), !c3 && null != e3) for (m3 = {}, a3 = 0; a3 < u4.attributes.length; a3++) m3[(y3 = u4.attributes[a3]).name] = y3.value;
    for (a3 in m3) y3 = m3[a3], "dangerouslySetInnerHTML" == a3 ? p3 = y3 : "children" == a3 || a3 in k3 || "value" == a3 && "defaultValue" in k3 || "checked" == a3 && "defaultChecked" in k3 || N(u4, a3, null, y3, o3);
    for (a3 in k3) y3 = k3[a3], "children" == a3 ? v3 = y3 : "dangerouslySetInnerHTML" == a3 ? h3 = y3 : "value" == a3 ? w3 = y3 : "checked" == a3 ? _2 = y3 : c3 && "function" != typeof y3 || m3[a3] === y3 || N(u4, a3, y3, m3[a3], o3);
    if (h3) c3 || p3 && (h3.__html == p3.__html || h3.__html == u4.innerHTML) || (u4.innerHTML = h3.__html), t3.__k = [];
    else if (p3 && (u4.innerHTML = ""), L("template" == t3.type ? u4.content : u4, g(v3) ? v3 : [v3], t3, i4, r3, "foreignObject" == x2 ? "http://www.w3.org/1999/xhtml" : o3, e3, f4, e3 ? e3[0] : i4.__k && $(i4, 0), c3, s3), null != e3) for (a3 = e3.length; a3--; ) b(e3[a3]);
    c3 || (a3 = "value", "progress" == x2 && null == w3 ? u4.removeAttribute("value") : null != w3 && (w3 !== u4[a3] || "progress" == x2 && !w3 || "option" == x2 && w3 != m3[a3]) && N(u4, a3, w3, m3[a3], o3), a3 = "checked", null != _2 && _2 != u4[a3] && N(u4, a3, _2, m3[a3], o3));
  }
  return u4;
}
function J(n2, u4, t3) {
  try {
    if ("function" == typeof n2) {
      var i4 = "function" == typeof n2.__u;
      i4 && n2.__u(), i4 && null == u4 || (n2.__u = n2(u4));
    } else n2.current = u4;
  } catch (n3) {
    l.__e(n3, t3);
  }
}
function K(n2, u4, t3) {
  var i4, r3;
  if (l.unmount && l.unmount(n2), (i4 = n2.ref) && (i4.current && i4.current != n2.__e || J(i4, null, u4)), null != (i4 = n2.__c)) {
    if (i4.componentWillUnmount) try {
      i4.componentWillUnmount();
    } catch (n3) {
      l.__e(n3, u4);
    }
    i4.base = i4.__P = null;
  }
  if (i4 = n2.__k) for (r3 = 0; r3 < i4.length; r3++) i4[r3] && K(i4[r3], u4, t3 || "function" != typeof n2.type);
  t3 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
}
function Q(n2, l3, u4) {
  return this.constructor(n2, u4);
}
function R(u4, t3, i4) {
  var r3, o3, e3, f4;
  t3 == document && (t3 = document.documentElement), l.__ && l.__(u4, t3), o3 = (r3 = "function" == typeof i4) ? null : i4 && i4.__k || t3.__k, e3 = [], f4 = [], q(t3, u4 = (!r3 && i4 || t3).__k = k(S, null, [u4]), o3 || d, d, t3.namespaceURI, !r3 && i4 ? [i4] : o3 ? null : t3.firstChild ? n.call(t3.childNodes) : null, e3, !r3 && i4 ? i4 : o3 ? o3.__e : t3.firstChild, r3, f4), D(e3, u4, f4);
}
n = w.slice, l = { __e: function(n2, l3, u4, t3) {
  for (var i4, r3, o3; l3 = l3.__; ) if ((i4 = l3.__c) && !i4.__) try {
    if ((r3 = i4.constructor) && null != r3.getDerivedStateFromError && (i4.setState(r3.getDerivedStateFromError(n2)), o3 = i4.__d), null != i4.componentDidCatch && (i4.componentDidCatch(n2, t3 || {}), o3 = i4.__d), o3) return i4.__E = i4;
  } catch (l4) {
    n2 = l4;
  }
  throw n2;
} }, u = 0, t = function(n2) {
  return null != n2 && void 0 === n2.constructor;
}, C.prototype.setState = function(n2, l3) {
  var u4;
  u4 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u4), this.props)), n2 && m(u4, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), A(this));
}, C.prototype.forceUpdate = function(n2) {
  this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
}, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l3) {
  return n2.__v.__b - l3.__v.__b;
}, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, s = "__a" + f, a = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v = V(true), y = 0;

// node_modules/preact/hooks/dist/hooks.module.js
var t2;
var r2;
var u2;
var i2;
var o2 = 0;
var f2 = [];
var c2 = l;
var e2 = c2.__b;
var a2 = c2.__r;
var v2 = c2.diffed;
var l2 = c2.__c;
var m2 = c2.unmount;
var s2 = c2.__;
function p2(n2, t3) {
  c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
  var u4 = r2.__H || (r2.__H = { __: [], __h: [] });
  return n2 >= u4.__.length && u4.__.push({}), u4.__[n2];
}
function d2(n2) {
  return o2 = 1, h2(D2, n2);
}
function h2(n2, u4, i4) {
  var o3 = p2(t2++, 2);
  if (o3.t = n2, !o3.__c && (o3.__ = [i4 ? i4(u4) : D2(void 0, u4), function(n3) {
    var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
    t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
  }], o3.__c = r2, !r2.__f)) {
    var f4 = function(n3, t3, r3) {
      if (!o3.__c.__H) return true;
      var u5 = o3.__c.__H.__.filter(function(n4) {
        return n4.__c;
      });
      if (u5.every(function(n4) {
        return !n4.__N;
      })) return !c3 || c3.call(this, n3, t3, r3);
      var i5 = o3.__c.props !== n3;
      return u5.some(function(n4) {
        if (n4.__N) {
          var t4 = n4.__[0];
          n4.__ = n4.__N, n4.__N = void 0, t4 !== n4.__[0] && (i5 = true);
        }
      }), c3 && c3.call(this, n3, t3, r3) || i5;
    };
    r2.__f = true;
    var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
    r2.componentWillUpdate = function(n3, t3, r3) {
      if (this.__e) {
        var u5 = c3;
        c3 = void 0, f4(n3, t3, r3), c3 = u5;
      }
      e3 && e3.call(this, n3, t3, r3);
    }, r2.shouldComponentUpdate = f4;
  }
  return o3.__N || o3.__;
}
function y2(n2, u4) {
  var i4 = p2(t2++, 3);
  !c2.__s && C2(i4.__H, u4) && (i4.__ = n2, i4.u = u4, r2.__H.__h.push(i4));
}
function A2(n2) {
  return o2 = 5, T2(function() {
    return { current: n2 };
  }, []);
}
function T2(n2, r3) {
  var u4 = p2(t2++, 7);
  return C2(u4.__H, r3) && (u4.__ = n2(), u4.__H = r3, u4.__h = n2), u4.__;
}
function j2() {
  for (var n2; n2 = f2.shift(); ) {
    var t3 = n2.__H;
    if (n2.__P && t3) try {
      t3.__h.some(z2), t3.__h.some(B2), t3.__h = [];
    } catch (r3) {
      t3.__h = [], c2.__e(r3, n2.__v);
    }
  }
}
c2.__b = function(n2) {
  r2 = null, e2 && e2(n2);
}, c2.__ = function(n2, t3) {
  n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), s2 && s2(n2, t3);
}, c2.__r = function(n2) {
  a2 && a2(n2), t2 = 0;
  var i4 = (r2 = n2.__c).__H;
  i4 && (u2 === r2 ? (i4.__h = [], r2.__h = [], i4.__.some(function(n3) {
    n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = void 0;
  })) : (i4.__h.some(z2), i4.__h.some(B2), i4.__h = [], t2 = 0)), u2 = r2;
}, c2.diffed = function(n2) {
  v2 && v2(n2);
  var t3 = n2.__c;
  t3 && t3.__H && (t3.__H.__h.length && (1 !== f2.push(t3) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.some(function(n3) {
    n3.u && (n3.__H = n3.u), n3.u = void 0;
  })), u2 = r2 = null;
}, c2.__c = function(n2, t3) {
  t3.some(function(n3) {
    try {
      n3.__h.some(z2), n3.__h = n3.__h.filter(function(n4) {
        return !n4.__ || B2(n4);
      });
    } catch (r3) {
      t3.some(function(n4) {
        n4.__h && (n4.__h = []);
      }), t3 = [], c2.__e(r3, n3.__v);
    }
  }), l2 && l2(n2, t3);
}, c2.unmount = function(n2) {
  m2 && m2(n2);
  var t3, r3 = n2.__c;
  r3 && r3.__H && (r3.__H.__.some(function(n3) {
    try {
      z2(n3);
    } catch (n4) {
      t3 = n4;
    }
  }), r3.__H = void 0, t3 && c2.__e(t3, r3.__v));
};
var k2 = "function" == typeof requestAnimationFrame;
function w2(n2) {
  var t3, r3 = function() {
    clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2);
  }, u4 = setTimeout(r3, 35);
  k2 && (t3 = requestAnimationFrame(r3));
}
function z2(n2) {
  var t3 = r2, u4 = n2.__c;
  "function" == typeof u4 && (n2.__c = void 0, u4()), r2 = t3;
}
function B2(n2) {
  var t3 = r2;
  n2.__c = n2.__(), r2 = t3;
}
function C2(n2, t3) {
  return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
    return t4 !== n2[r3];
  });
}
function D2(n2, t3) {
  return "function" == typeof t3 ? t3(n2) : t3;
}

// node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
var f3 = 0;
var i3 = Array.isArray;
function u3(e3, t3, n2, o3, i4, u4) {
  t3 || (t3 = {});
  var a3, c3, p3 = t3;
  if ("ref" in p3) for (c3 in p3 = {}, t3) "ref" == c3 ? a3 = t3[c3] : p3[c3] = t3[c3];
  var l3 = { type: e3, props: p3, key: n2, ref: a3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f3, __i: -1, __u: 0, __source: i4, __self: u4 };
  if ("function" == typeof e3 && (a3 = e3.defaultProps)) for (c3 in a3) void 0 === p3[c3] && (p3[c3] = a3[c3]);
  return l.vnode && l.vnode(l3), l3;
}

// src/components/atoms/Icon.tsx
var PATHS = {
  overview: /* @__PURE__ */ u3("path", { d: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" }),
  sessions: /* @__PURE__ */ u3("path", { d: "M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" }),
  chains: /* @__PURE__ */ u3("path", { d: "M10.59 13.41L4 6.83l1.41-1.42 6.59 6.59 6.59-6.59L20 6.83l-9.41 9.41z" }),
  tournaments: /* @__PURE__ */ u3("path", { d: "M5 4h14v3a5 5 0 0 1-4 4.9V14h2v2H7v-2h2v-2.1A5 5 0 0 1 5 7V4z" }),
  events: /* @__PURE__ */ u3("circle", { cx: "12", cy: "12", r: "9" }),
  search: /* @__PURE__ */ u3("path", { d: "M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" }),
  audit: /* @__PURE__ */ u3("path", { d: "M9 11H7v8h2v-8zm4-6h-2v14h2V5zm4 9h-2v5h2v-5z" }),
  settings: /* @__PURE__ */ u3("path", { d: "M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.04 7.04 0 0 0-1.62-.94L14.4 2.7a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.62a7.04 7.04 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.62c.04.25.25.42.5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.62c.58-.24 1.12-.56 1.62-.94l2.39.96c.23.09.5 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" }),
  plus: /* @__PURE__ */ u3("path", { d: "M12 5v14M5 12h14" })
};
function Icon({ name, size = 16 }) {
  return /* @__PURE__ */ u3(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.6",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      children: PATHS[name]
    }
  );
}

// src/hooks/useSSE.ts
var client = {
  source: null,
  listeners: /* @__PURE__ */ new Map(),
  refCount: 0
};
function ensureOpen() {
  if (client.source) return;
  const src = new EventSource("/api/stream");
  src.addEventListener("hello", () => {
  });
  for (const [topic] of client.listeners) {
    src.addEventListener(topic, makeDispatcher(topic));
  }
  client.source = src;
}
function makeDispatcher(topic) {
  return () => {
    const set = client.listeners.get(topic);
    if (!set) return;
    for (const cb of set) {
      try {
        cb();
      } catch {
      }
    }
  };
}
function subscribe(topic, cb) {
  let set = client.listeners.get(topic);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    client.listeners.set(topic, set);
    if (client.source) {
      client.source.addEventListener(topic, makeDispatcher(topic));
    }
  }
  set.add(cb);
  client.refCount++;
  ensureOpen();
}
function unsubscribe(topic, cb) {
  const set = client.listeners.get(topic);
  if (set) {
    set.delete(cb);
    if (set.size === 0) client.listeners.delete(topic);
  }
  client.refCount = Math.max(0, client.refCount - 1);
  if (client.refCount === 0 && client.source) {
    client.source.close();
    client.source = null;
  }
}
function useSSE(topics, callback) {
  y2(() => {
    const ts = Array.isArray(topics) ? topics : [topics];
    ts.forEach((t3) => subscribe(t3, callback));
    return () => {
      ts.forEach((t3) => unsubscribe(t3, callback));
    };
  }, [Array.isArray(topics) ? topics.join(",") : topics]);
}

// src/hooks/usePolling.ts
function usePolling(url, intervalMs, sseTopic) {
  const [state, setState] = d2({ data: null, loading: true, error: null });
  const cancelled = A2(false);
  const fetchRef = A2();
  y2(() => {
    cancelled.current = false;
    let timer;
    const tick = async () => {
      try {
        const r3 = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r3.ok) throw new Error(`${r3.status} ${r3.statusText}`);
        const data = await r3.json();
        if (!cancelled.current) {
          setState({ data, loading: false, error: null });
        }
      } catch (e3) {
        if (!cancelled.current) {
          setState((prev) => ({ ...prev, loading: false, error: e3 }));
        }
      }
    };
    fetchRef.current = tick;
    tick();
    timer = window.setInterval(tick, intervalMs);
    return () => {
      cancelled.current = true;
      if (timer !== void 0) window.clearInterval(timer);
    };
  }, [url, intervalMs]);
  useSSE(sseTopic ?? "", () => {
    if (sseTopic) fetchRef.current?.();
  });
  return state;
}

// src/hooks/useProjects.ts
var POLL_INTERVAL_MS = 3e4;
function useProjects() {
  return usePolling("/api/projects", POLL_INTERVAL_MS, "projects");
}

// src/components/organisms/Sidebar.tsx
var VIEWS = [
  { id: "overview", label: "Overview", icon: "overview", href: "/" },
  { id: "sessions", label: "Sessions", icon: "sessions", href: "/" },
  { id: "chains", label: "Chains", icon: "chains" },
  { id: "tournaments", label: "Tournaments", icon: "tournaments" },
  { id: "events", label: "Events", icon: "events", href: "/audit" },
  { id: "search", label: "Search", icon: "search" },
  { id: "audit", label: "Audit", icon: "audit", href: "/audit" },
  { id: "settings", label: "Settings", icon: "settings", href: "/settings" }
];
var SUBVIEWS = [
  "Active Work",
  "Waiting for Input",
  "Reviewers",
  "High Cost",
  "All Sessions"
];
function Sidebar({ activeView = "overview", currentProjectKey }) {
  const { data: projects } = useProjects();
  return /* @__PURE__ */ u3("aside", { class: "app-shell__sidebar", children: [
    /* @__PURE__ */ u3("div", { class: "sidebar__brand", children: [
      /* @__PURE__ */ u3("span", { class: "sidebar__brand-mark", "aria-hidden": "true" }),
      "fleet"
    ] }),
    /* @__PURE__ */ u3("nav", { class: "sidebar__section", "aria-label": "Primary views", children: /* @__PURE__ */ u3("ul", { class: "sidebar__nav", children: VIEWS.map((v3) => /* @__PURE__ */ u3(
      "li",
      {
        class: `sidebar__nav-item${v3.id === activeView ? " sidebar__nav-item--active" : ""}`,
        onClick: () => {
          if (v3.href) window.location.hash = v3.href;
        },
        role: v3.href ? "link" : void 0,
        style: { cursor: v3.href ? "pointer" : "default" },
        children: [
          /* @__PURE__ */ u3(Icon, { name: v3.icon }),
          v3.label
        ]
      },
      v3.id
    )) }) }),
    /* @__PURE__ */ u3("div", { class: "sidebar__section", children: [
      /* @__PURE__ */ u3("div", { class: "sidebar__heading", children: "Views" }),
      /* @__PURE__ */ u3("ul", { class: "sidebar__nav", children: SUBVIEWS.map((s3) => /* @__PURE__ */ u3("li", { class: "sidebar__nav-item", children: s3 }, s3)) })
    ] }),
    /* @__PURE__ */ u3("div", { class: "sidebar__section", children: [
      /* @__PURE__ */ u3("div", { class: "sidebar__heading", children: "Projects" }),
      /* @__PURE__ */ u3("ul", { class: "sidebar__nav", children: [
        (projects ?? []).map((p3) => {
          const isActive = p3.key === currentProjectKey;
          const label = shortKey(p3.key);
          const item = /* @__PURE__ */ u3(S, { children: [
            /* @__PURE__ */ u3("span", { style: { flex: 1 }, children: label }),
            p3.port ? /* @__PURE__ */ u3("span", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }, children: [
              ":",
              p3.port
            ] }) : null
          ] });
          const cls = `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}`;
          return p3.url && !isActive ? /* @__PURE__ */ u3("li", { class: cls, children: /* @__PURE__ */ u3("a", { href: p3.url, style: { color: "inherit", textDecoration: "none", display: "flex", alignItems: "center", gap: 8, width: "100%" }, children: item }) }, p3.key) : /* @__PURE__ */ u3("li", { class: cls, children: item }, p3.key);
        }),
        projects && projects.length === 0 ? /* @__PURE__ */ u3("li", { class: "sidebar__nav-item", style: { color: "var(--color-text-tertiary)", fontStyle: "italic" }, children: "No projects discovered" }) : null
      ] })
    ] }),
    /* @__PURE__ */ u3("div", { class: "sidebar__user", children: [
      /* @__PURE__ */ u3("div", { style: { width: 28, height: 28, borderRadius: "50%", background: "#cbd5e1" } }),
      /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3("div", { style: { fontWeight: 600 }, children: "You" }),
        /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)", fontSize: "var(--text-xs)" }, children: "local" })
      ] })
    ] })
  ] });
}
function shortKey(key) {
  if (key.length <= 8) return key;
  return `${key.slice(0, 4)}\u2026${key.slice(-4)}`;
}

// src/components/atoms/Button.tsx
function Button({ variant = "default", type = "button", onClick, disabled, children }) {
  const cls = variant === "primary" ? "btn btn--primary" : "btn";
  return /* @__PURE__ */ u3("button", { class: cls, type, onClick, disabled, children });
}

// src/components/organisms/TopBar.tsx
var RANGES = ["Live", "5m", "15m", "1h", "6h", "24h"];
function TopBar({ title, onSpawnClick }) {
  const [range, setRange] = d2("Live");
  return /* @__PURE__ */ u3("div", { class: "app-shell__topbar", children: [
    /* @__PURE__ */ u3("div", { class: "topbar__title", children: title }),
    /* @__PURE__ */ u3("div", { class: "topbar__spacer" }),
    /* @__PURE__ */ u3("div", { class: "topbar__time-range", role: "group", "aria-label": "Time range", children: RANGES.map((r3) => /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        "aria-pressed": r3 === range,
        onClick: () => setRange(r3),
        children: r3
      },
      r3
    )) }),
    /* @__PURE__ */ u3(Button, { variant: "primary", onClick: onSpawnClick, children: [
      /* @__PURE__ */ u3(Icon, { name: "plus", size: 14 }),
      "Spawn"
    ] })
  ] });
}

// src/components/templates/AppShell.tsx
function AppShell({ activeView, topBarTitle, onSpawnClick, children }) {
  return /* @__PURE__ */ u3("div", { class: "app-shell", children: [
    /* @__PURE__ */ u3(Sidebar, { activeView }),
    /* @__PURE__ */ u3("main", { class: "app-shell__main", children: [
      /* @__PURE__ */ u3(TopBar, { title: topBarTitle, onSpawnClick }),
      /* @__PURE__ */ u3("div", { class: "app-shell__content", children })
    ] })
  ] });
}

// src/components/atoms/Sparkline.tsx
function Sparkline({ data, height = 28, color = "currentColor" }) {
  if (data.length < 2) {
    return /* @__PURE__ */ u3("svg", { class: "sparkline", viewBox: `0 0 100 ${height}`, preserveAspectRatio: "none" });
  }
  const w3 = 100;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w3 / (data.length - 1);
  const points = data.map((d3, i4) => {
    const x2 = (i4 * step).toFixed(2);
    const y3 = (height - (d3 - min) / range * (height - 2) - 1).toFixed(2);
    return `${x2},${y3}`;
  }).join(" ");
  return /* @__PURE__ */ u3(
    "svg",
    {
      class: "sparkline",
      viewBox: `0 0 ${w3} ${height}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
      children: /* @__PURE__ */ u3(
        "polyline",
        {
          fill: "none",
          stroke: color,
          "stroke-width": "1.5",
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
          points
        }
      )
    }
  );
}

// src/components/molecules/StatCard.tsx
function StatCard({ label, value, delta, caption, series, accent }) {
  return /* @__PURE__ */ u3("div", { class: "stat-card", children: [
    /* @__PURE__ */ u3("div", { class: "stat-card__label", children: label }),
    /* @__PURE__ */ u3("div", { class: "stat-card__value", children: value }),
    delta ? /* @__PURE__ */ u3("div", { class: `stat-card__delta stat-card__delta--${delta.direction ?? "flat"}`, children: [
      delta.direction === "up" ? "\u2191" : delta.direction === "down" ? "\u2193" : "",
      " ",
      delta.value
    ] }) : null,
    caption ? /* @__PURE__ */ u3("div", { class: "stat-card__delta", children: caption }) : null,
    series ? /* @__PURE__ */ u3("div", { class: "stat-card__sparkline", style: { color: accent ?? "var(--color-accent)" }, children: /* @__PURE__ */ u3(Sparkline, { data: series }) }) : null
  ] });
}

// src/components/organisms/StatRibbon.tsx
function StatRibbon({ stats }) {
  return /* @__PURE__ */ u3("section", { class: "stat-ribbon", "aria-label": "Fleet statistics", children: [
    /* @__PURE__ */ u3(
      StatCard,
      {
        label: "Active Sessions",
        value: stats.active_sessions.value,
        caption: `/${stats.active_sessions.total} running`
      }
    ),
    /* @__PURE__ */ u3(
      StatCard,
      {
        label: "Needs Input",
        value: stats.needs_input.value,
        delta: { value: String(stats.needs_input.delta), direction: stats.needs_input.delta > 0 ? "up" : "flat" }
      }
    ),
    /* @__PURE__ */ u3(
      StatCard,
      {
        label: "Completed",
        value: stats.completed.value,
        caption: stats.completed.window
      }
    ),
    /* @__PURE__ */ u3(
      StatCard,
      {
        label: "Est. Cost (24h)",
        value: stats.est_cost_24h.value,
        delta: { value: `${stats.est_cost_24h.delta_pct}%`, direction: "up" },
        series: stats.est_cost_24h.series
      }
    ),
    /* @__PURE__ */ u3(
      StatCard,
      {
        label: "Runtime (24h)",
        value: stats.runtime_24h.value,
        caption: "Total",
        series: stats.runtime_24h.series,
        accent: "var(--color-state-working)"
      }
    ),
    /* @__PURE__ */ u3(
      StatCard,
      {
        label: "Events (24h)",
        value: stats.events_24h.value.toLocaleString(),
        delta: { value: `${stats.events_24h.delta_pct}%`, direction: "up" },
        series: stats.events_24h.series,
        accent: "var(--color-state-reviewing)"
      }
    )
  ] });
}

// src/components/atoms/Badge.tsx
var LABEL = {
  "working": "Working",
  "needs-input": "Needs Input",
  "error": "Error",
  "done": "Done",
  "idle": "Idle",
  "reviewing": "Reviewing",
  "blocked": "Blocked",
  "completed": "Completed"
};
function Badge({ state, label }) {
  const text = label ?? LABEL[state] ?? state;
  return /* @__PURE__ */ u3("span", { class: `badge badge--${state}`, children: text });
}

// src/components/molecules/SearchField.tsx
function SearchField({ placeholder = "Search\u2026", initial = "", onChange }) {
  const [v3, setV] = d2(initial);
  return /* @__PURE__ */ u3("div", { class: "search-field", children: /* @__PURE__ */ u3(
    "input",
    {
      type: "text",
      value: v3,
      placeholder,
      onInput: (e3) => {
        const next = e3.currentTarget.value;
        setV(next);
        onChange?.(next);
      }
    }
  ) });
}

// src/components/organisms/SessionTable.tsx
var STATE_FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "Active", match: (s3) => s3 === "starting" || s3 === "working" || s3 === "reviewing" },
  { id: "needs-input", label: "Needs Input", match: (s3) => s3 === "needs-input" || s3 === "blocked" || s3 === "error" },
  { id: "done", label: "Done", match: (s3) => s3 === "done" || s3 === "completed" || s3 === "idle" }
];
function SessionTable({ rows, loading, density = "comfortable", onRowClick }) {
  const [query, setQuery] = d2("");
  const [filter, setFilter] = d2("all");
  const filtered = T2(() => {
    const q2 = query.trim().toLowerCase();
    const sf = STATE_FILTERS.find((f4) => f4.id === filter);
    return rows.filter((r3) => {
      if (!sf.match(r3.state)) return false;
      if (!q2) return true;
      return r3.ticket.toLowerCase().includes(q2) || r3.slug.toLowerCase().includes(q2) || (r3.branch || "").toLowerCase().includes(q2) || (r3.parent || "").toLowerCase().includes(q2);
    });
  }, [rows, query, filter]);
  return /* @__PURE__ */ u3("div", { children: [
    /* @__PURE__ */ u3("header", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ u3("h2", { style: { margin: 0, fontSize: "var(--text-lg)", fontWeight: 600, letterSpacing: "-0.01em" }, children: "Session Table" }),
      /* @__PURE__ */ u3("div", { class: "filter-chips", role: "group", "aria-label": "State filter", children: STATE_FILTERS.map((f4) => /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: `filter-chip${f4.id === filter ? " filter-chip--active" : ""}`,
          "aria-pressed": f4.id === filter,
          onClick: () => setFilter(f4.id),
          children: f4.label
        },
        f4.id
      )) }),
      /* @__PURE__ */ u3("span", { style: { flex: 1 } }),
      /* @__PURE__ */ u3("span", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }, children: [
        filtered.length,
        " / ",
        rows.length
      ] }),
      /* @__PURE__ */ u3("div", { style: { width: 240 }, children: /* @__PURE__ */ u3(SearchField, { placeholder: "Filter ticket, slug, branch\u2026", onChange: setQuery }) })
    ] }),
    /* @__PURE__ */ u3(
      "div",
      {
        class: `session-table${density === "compact" ? " session-table--compact" : ""}`,
        role: "table",
        "aria-label": "Sessions",
        children: [
          /* @__PURE__ */ u3("div", { class: "session-table__header", role: "row", children: [
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Ticket" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Session" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "State" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Parent" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Branch" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Activity" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Cost" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Runtime" }),
            /* @__PURE__ */ u3("div", { role: "columnheader", children: "Progress" })
          ] }),
          loading && rows.length === 0 ? /* @__PURE__ */ u3(EmptyRow, { children: "Loading sessions\u2026" }) : filtered.length === 0 && rows.length > 0 ? /* @__PURE__ */ u3(EmptyRow, { children: "No sessions match the current filter." }) : rows.length === 0 ? /* @__PURE__ */ u3(EmptyRow, { children: [
            "No sessions yet. Spawn one with",
            " ",
            /* @__PURE__ */ u3("code", { children: "spawn-claude-feature <TICKET> <slug> --prompt-file <path> --full-auto" }),
            " ",
            "or ",
            /* @__PURE__ */ u3("code", { children: "/fleet:spawn <TICKET>" }),
            " from a Claude Code session."
          ] }) : filtered.map((r3) => /* @__PURE__ */ u3(
            "div",
            {
              class: "session-table__row",
              role: "row",
              onClick: () => onRowClick?.(r3),
              children: [
                /* @__PURE__ */ u3("div", { role: "cell", style: { fontWeight: 600 }, children: r3.ticket }),
                /* @__PURE__ */ u3("div", { role: "cell", style: { color: "var(--color-text-secondary)" }, children: r3.slug || "\u2014" }),
                /* @__PURE__ */ u3("div", { role: "cell", children: [
                  /* @__PURE__ */ u3(Badge, { state: r3.state }),
                  r3.drift != null && r3.drift > 0.6 ? /* @__PURE__ */ u3(
                    "span",
                    {
                      title: `Drift score ${Math.round(r3.drift * 100)}% \u2014 agent may be stuck`,
                      style: { marginLeft: 6, color: "var(--color-state-needs-input)", fontSize: "var(--text-xs)" },
                      children: "\u26A0"
                    }
                  ) : null
                ] }),
                /* @__PURE__ */ u3("div", { role: "cell", style: { color: "var(--color-text-secondary)" }, children: r3.parent || "\u2014" }),
                /* @__PURE__ */ u3("div", { role: "cell", style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }, children: r3.branch || "\u2014" }),
                /* @__PURE__ */ u3("div", { role: "cell", children: r3.activity }),
                /* @__PURE__ */ u3("div", { role: "cell", children: r3.cost }),
                /* @__PURE__ */ u3("div", { role: "cell", children: r3.runtime }),
                /* @__PURE__ */ u3("div", { role: "cell", children: /* @__PURE__ */ u3("div", { class: "session-table__progress", "aria-label": `${Math.round(r3.progress * 100)}% complete`, children: /* @__PURE__ */ u3(
                  "div",
                  {
                    class: "session-table__progress-bar",
                    style: { width: `${Math.round(r3.progress * 100)}%` }
                  }
                ) }) })
              ]
            },
            r3.ticket
          ))
        ]
      }
    )
  ] });
}
function EmptyRow({ children }) {
  return /* @__PURE__ */ u3(
    "div",
    {
      role: "row",
      style: {
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--color-text-secondary)",
        fontSize: "var(--text-sm)"
      },
      children
    }
  );
}

// src/components/organisms/TerminalView.tsx
function unescapeMultiline(s3) {
  let out = "";
  for (let i4 = 0; i4 < s3.length; i4++) {
    const c3 = s3[i4];
    if (c3 === "\\" && i4 + 1 < s3.length) {
      const n2 = s3[i4 + 1];
      if (n2 === "n") {
        out += "\n";
        i4++;
        continue;
      }
      if (n2 === "r") {
        out += "\r";
        i4++;
        continue;
      }
      if (n2 === "\\") {
        out += "\\";
        i4++;
        continue;
      }
    }
    out += c3;
  }
  return out;
}
function TerminalView({ ticket, height = 360 }) {
  const [lines, setLines] = d2("");
  const [error, setError] = d2(null);
  const ref = A2(null);
  y2(() => {
    setLines("");
    setError(null);
    const src = new EventSource(`/api/sessions/${encodeURIComponent(ticket)}/stream`);
    src.addEventListener("snapshot", (e3) => {
      const data = e3.data;
      setLines(unescapeMultiline(data));
    });
    src.addEventListener("append", (e3) => {
      const data = e3.data;
      setLines((prev) => prev + unescapeMultiline(data));
    });
    src.addEventListener("error", () => {
      setError("connection interrupted");
    });
    return () => src.close();
  }, [ticket]);
  y2(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return /* @__PURE__ */ u3("div", { class: "terminal-view", children: [
    error ? /* @__PURE__ */ u3("div", { class: "terminal-view__notice", children: error }) : null,
    /* @__PURE__ */ u3("pre", { ref, class: "terminal-view__pre", style: { height: typeof height === "number" ? `${height}px` : height }, children: lines || "(waiting for output\u2026)" })
  ] });
}

// src/api.ts
async function sendMessage(ticket, message) {
  const r3 = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  if (!r3.ok) throw new Error(await readError(r3));
}
async function killSession(ticket) {
  const r3 = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/kill`, { method: "POST" });
  if (!r3.ok) {
    const e3 = await readError(r3);
    if (r3.status === 409) {
      throw new Error(`UNCOMMITTED: ${e3}`);
    }
    throw new Error(e3);
  }
}
async function estimateCost(prompt, fullAuto) {
  const r3 = await fetch("/api/estimate-cost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, full_auto: fullAuto })
  });
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
async function spawnFeature(args) {
  const r3 = await fetch("/api/spawn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
async function broadcast(message) {
  const r3 = await fetch("/api/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
async function spawnReviewer(parentTicket, prompt, fullAuto = true) {
  const r3 = await fetch(`/api/sessions/${encodeURIComponent(parentTicket)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt ?? "", full_auto: fullAuto })
  });
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
async function readError(r3) {
  try {
    const j3 = await r3.json();
    return j3.error || `${r3.status} ${r3.statusText}`;
  } catch {
    return `${r3.status} ${r3.statusText}`;
  }
}
async function loadSettings() {
  const r3 = await fetch("/api/settings");
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
async function saveSettings(s3) {
  const r3 = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s3)
  });
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
async function fetchVersion() {
  try {
    const r3 = await fetch("/api/version");
    if (r3.ok) return r3.json();
  } catch {
  }
  return { build: "dev", project: "unknown" };
}

// src/components/organisms/SessionDetailPanel.tsx
var TABS = ["Overview", "Logs"];
function SessionDetailPanel({ ticket, onClose, onKilled }) {
  const [data, setData] = d2(null);
  const [error, setError] = d2(null);
  const [tab, setTab] = d2("Overview");
  const [modal, setModal] = d2(null);
  const [actionMsg, setActionMsg] = d2(null);
  y2(() => {
    setData(null);
    setError(null);
    const url = `/api/sessions/${encodeURIComponent(ticket)}`;
    const load = () => fetch(url).then((r3) => r3.ok ? r3.json() : Promise.reject(new Error(`${r3.status} ${r3.statusText}`))).then(setData).catch((e3) => setError(e3.message));
    load();
    const id = window.setInterval(load, 5e3);
    return () => window.clearInterval(id);
  }, [ticket]);
  return /* @__PURE__ */ u3("aside", { class: "detail-panel", children: [
    /* @__PURE__ */ u3("header", { class: "detail-panel__header", children: [
      /* @__PURE__ */ u3("div", { class: "detail-panel__crumbs", children: [
        /* @__PURE__ */ u3("span", { style: { color: "var(--color-text-tertiary)" }, children: "Sessions \u203A" }),
        /* @__PURE__ */ u3("strong", { children: ticket }),
        data ? /* @__PURE__ */ u3("span", { style: { color: "var(--color-text-secondary)" }, children: data.slug }) : null,
        data ? /* @__PURE__ */ u3(Badge, { state: data.state }) : null
      ] }),
      /* @__PURE__ */ u3("div", { class: "detail-panel__actions", children: [
        /* @__PURE__ */ u3(Button, { onClick: () => setModal("send"), children: "Send Input" }),
        /* @__PURE__ */ u3(Button, { onClick: () => setModal("review"), children: "Spawn Reviewer" }),
        /* @__PURE__ */ u3(Button, { onClick: () => {
          window.location.hash = `/sessions/${encodeURIComponent(ticket)}/replay`;
        }, children: "Replay" }),
        /* @__PURE__ */ u3(Button, { onClick: () => setModal("kill"), children: "Kill" }),
        onClose ? /* @__PURE__ */ u3(Button, { onClick: onClose, children: "Close" }) : null
      ] }),
      actionMsg ? /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-xs)", color: "var(--color-state-done)" }, children: actionMsg }) : null
    ] }),
    /* @__PURE__ */ u3("nav", { class: "detail-panel__tabs", role: "tablist", children: TABS.map((t3) => /* @__PURE__ */ u3(
      "button",
      {
        class: `detail-panel__tab${t3 === tab ? " detail-panel__tab--active" : ""}`,
        type: "button",
        role: "tab",
        "aria-selected": t3 === tab,
        onClick: () => setTab(t3),
        children: t3
      },
      t3
    )) }),
    /* @__PURE__ */ u3("div", { class: "detail-panel__body", children: error ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)" }, children: error }) : tab === "Overview" ? /* @__PURE__ */ u3(OverviewTab, { row: data }) : /* @__PURE__ */ u3(TerminalView, { ticket }) }),
    modal === "send" ? /* @__PURE__ */ u3(
      SendModal,
      {
        ticket,
        onClose: () => setModal(null),
        onSent: (text) => {
          setModal(null);
          setActionMsg(`Sent: ${text.slice(0, 40)}${text.length > 40 ? "\u2026" : ""}`);
          window.setTimeout(() => setActionMsg(null), 3e3);
        }
      }
    ) : null,
    modal === "kill" ? /* @__PURE__ */ u3(
      KillModal,
      {
        ticket,
        onClose: () => setModal(null),
        onKilled: () => {
          setModal(null);
          onKilled?.();
          onClose?.();
        }
      }
    ) : null,
    modal === "review" ? /* @__PURE__ */ u3(
      ReviewModal,
      {
        ticket,
        onClose: () => setModal(null),
        onSpawned: (child) => {
          setModal(null);
          setActionMsg(`Spawned reviewer ${child}`);
          window.setTimeout(() => setActionMsg(null), 4e3);
        }
      }
    ) : null
  ] });
}
function ReviewModal({ ticket, onClose, onSpawned }) {
  const [prompt, setPrompt] = d2("");
  const [submitting, setSubmitting] = d2(false);
  const [err, setErr] = d2(null);
  return /* @__PURE__ */ u3(Modal, { title: `Spawn reviewer for ${ticket}`, onClose, children: [
    /* @__PURE__ */ u3("p", { style: { fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }, children: [
      "Spawns a child session at ",
      /* @__PURE__ */ u3("code", { children: [
        ticket,
        "-rev"
      ] }),
      " with ",
      /* @__PURE__ */ u3("code", { children: [
        "--parent ",
        ticket
      ] }),
      " and ",
      /* @__PURE__ */ u3("code", { children: "--full-auto" }),
      ". The reviewer reads the parent's branch and posts a structured review."
    ] }),
    /* @__PURE__ */ u3(
      "textarea",
      {
        class: "modal__textarea",
        rows: 5,
        value: prompt,
        onInput: (e3) => setPrompt(e3.currentTarget.value),
        placeholder: `Optional review prompt \u2014 leave blank for the default (read branch/diff/PR for ${ticket}, post review).`
      }
    ),
    err ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)", fontSize: "var(--text-xs)" }, children: err }) : null,
    /* @__PURE__ */ u3("div", { class: "modal__actions", children: [
      /* @__PURE__ */ u3(Button, { onClick: onClose, children: "Cancel" }),
      /* @__PURE__ */ u3(
        Button,
        {
          variant: "primary",
          disabled: submitting,
          onClick: async () => {
            setSubmitting(true);
            setErr(null);
            try {
              const r3 = await spawnReviewer(ticket, prompt.trim() || void 0, true);
              onSpawned(r3.ticket);
            } catch (e3) {
              setErr(e3.message);
            } finally {
              setSubmitting(false);
            }
          },
          children: submitting ? "Spawning\u2026" : "Spawn Reviewer"
        }
      )
    ] })
  ] });
}
function OverviewTab({ row }) {
  if (!row) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: "Loading\u2026" });
  const conf = row.confidence ?? null;
  const drift = row.drift ?? null;
  return /* @__PURE__ */ u3(S, { children: [
    row.objective ? /* @__PURE__ */ u3("div", { style: { marginBottom: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }, children: [
      /* @__PURE__ */ u3("span", { style: { fontWeight: 600, color: "var(--color-text-primary)" }, children: "Objective: " }),
      row.objective
    ] }) : null,
    /* @__PURE__ */ u3("dl", { class: "detail-panel__meta", children: [
      /* @__PURE__ */ u3("dt", { children: "Branch" }),
      /* @__PURE__ */ u3("dd", { children: /* @__PURE__ */ u3("code", { children: row.branch || "\u2014" }) }),
      /* @__PURE__ */ u3("dt", { children: "Parent" }),
      /* @__PURE__ */ u3("dd", { children: row.parent || "\u2014" }),
      /* @__PURE__ */ u3("dt", { children: "Activity" }),
      /* @__PURE__ */ u3("dd", { children: row.activity }),
      /* @__PURE__ */ u3("dt", { children: "Cost" }),
      /* @__PURE__ */ u3("dd", { children: row.cost }),
      /* @__PURE__ */ u3("dt", { children: "Runtime" }),
      /* @__PURE__ */ u3("dd", { children: row.runtime }),
      /* @__PURE__ */ u3("dt", { children: "Progress" }),
      /* @__PURE__ */ u3("dd", { children: [
        Math.round(row.progress * 100),
        "%"
      ] }),
      conf != null ? /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("dt", { children: "State confidence" }),
        /* @__PURE__ */ u3("dd", { children: /* @__PURE__ */ u3(ConfidenceBar, { value: conf }) })
      ] }) : null,
      drift != null && drift > 0.05 ? /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("dt", { children: "Drift score" }),
        /* @__PURE__ */ u3("dd", { children: [
          /* @__PURE__ */ u3(ConfidenceBar, { value: drift, tone: "warn" }),
          drift > 0.6 ? /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-xs)", color: "var(--color-state-error)" }, children: "\u26A0 The agent has been quiet for a while \u2014 consider attaching to check on it." }) : null
        ] })
      ] }) : null
    ] })
  ] });
}
function ConfidenceBar({ value, tone = "good" }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = tone === "warn" ? "var(--color-state-needs-input)" : "var(--color-state-done)";
  return /* @__PURE__ */ u3("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
    /* @__PURE__ */ u3("div", { style: { width: 80, height: 6, background: "var(--color-bg-muted)", borderRadius: 999, overflow: "hidden" }, children: /* @__PURE__ */ u3("div", { style: { width: `${pct}%`, height: "100%", background: color } }) }),
    /* @__PURE__ */ u3("span", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }, children: [
      pct,
      "%"
    ] })
  ] });
}
function SendModal({ ticket, onClose, onSent }) {
  const [msg, setMsg] = d2("");
  const [sending, setSending] = d2(false);
  const [err, setErr] = d2(null);
  return /* @__PURE__ */ u3(Modal, { title: `Send input to ${ticket}`, onClose, children: [
    /* @__PURE__ */ u3(
      "textarea",
      {
        class: "modal__textarea",
        rows: 5,
        value: msg,
        onInput: (e3) => setMsg(e3.currentTarget.value),
        placeholder: "Type a message; Enter sends, Shift+Enter for newline",
        autoFocus: true
      }
    ),
    err ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)", fontSize: "var(--text-xs)" }, children: err }) : null,
    /* @__PURE__ */ u3("div", { class: "modal__actions", children: [
      /* @__PURE__ */ u3(Button, { onClick: onClose, children: "Cancel" }),
      /* @__PURE__ */ u3(
        Button,
        {
          variant: "primary",
          disabled: !msg.trim() || sending,
          onClick: async () => {
            setSending(true);
            setErr(null);
            try {
              await sendMessage(ticket, msg);
              onSent(msg);
            } catch (e3) {
              setErr(e3.message);
            } finally {
              setSending(false);
            }
          },
          children: sending ? "Sending\u2026" : "Send"
        }
      )
    ] })
  ] });
}
function KillModal({ ticket, onClose, onKilled }) {
  const [killing, setKilling] = d2(false);
  const [err, setErr] = d2(null);
  const [uncommitted, setUncommitted] = d2(false);
  return /* @__PURE__ */ u3(Modal, { title: `Kill ${ticket}?`, onClose, children: [
    /* @__PURE__ */ u3("p", { children: "This stops the tmux session, removes the worktree, and deletes the branch." }),
    /* @__PURE__ */ u3("p", { children: "If the worktree has unpushed work, the kill will refuse \u2014 investigate before forcing (per BDM-13 safety)." }),
    err ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)", fontSize: "var(--text-xs)" }, children: [
      uncommitted ? "\u26A0 Worktree has uncommitted changes. " : "",
      err
    ] }) : null,
    /* @__PURE__ */ u3("div", { class: "modal__actions", children: [
      /* @__PURE__ */ u3(Button, { onClick: onClose, children: "Cancel" }),
      /* @__PURE__ */ u3(
        Button,
        {
          variant: "primary",
          disabled: killing,
          onClick: async () => {
            setKilling(true);
            setErr(null);
            setUncommitted(false);
            try {
              await killSession(ticket);
              onKilled();
            } catch (e3) {
              const msg = e3.message;
              if (msg.startsWith("UNCOMMITTED:")) {
                setUncommitted(true);
                setErr(msg.replace(/^UNCOMMITTED:\s*/, ""));
              } else {
                setErr(msg);
              }
            } finally {
              setKilling(false);
            }
          },
          children: killing ? "Killing\u2026" : "Confirm Kill"
        }
      )
    ] })
  ] });
}
function Modal({ title, onClose, children }) {
  return /* @__PURE__ */ u3("div", { class: "modal-backdrop", onClick: onClose, children: /* @__PURE__ */ u3("div", { class: "modal", onClick: (e3) => e3.stopPropagation(), children: [
    /* @__PURE__ */ u3("header", { class: "modal__header", children: title }),
    /* @__PURE__ */ u3("div", { class: "modal__body", children })
  ] }) });
}

// src/components/organisms/SpawnModal.tsx
var TABS2 = ["Manual", "From Jira", "From Backlog"];
function SpawnModal({ onClose, onSpawned }) {
  const [tab, setTab] = d2("Manual");
  return /* @__PURE__ */ u3("div", { class: "modal-backdrop", onClick: onClose, children: /* @__PURE__ */ u3("div", { class: "modal modal--lg", onClick: (e3) => e3.stopPropagation(), children: [
    /* @__PURE__ */ u3("header", { class: "modal__header", children: "Spawn a new session" }),
    /* @__PURE__ */ u3("nav", { class: "modal__tabs", role: "tablist", children: TABS2.map((t3) => /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-selected": t3 === tab,
        class: `modal__tab${t3 === tab ? " modal__tab--active" : ""}`,
        onClick: () => setTab(t3),
        children: t3
      },
      t3
    )) }),
    /* @__PURE__ */ u3("div", { class: "modal__body", children: tab === "Manual" ? /* @__PURE__ */ u3(ManualTab, { onClose, onSpawned }) : tab === "From Jira" ? /* @__PURE__ */ u3(PlaceholderTab, { title: "Spawn from Jira ticket", hint: "Paste a ticket key (BDM-N); the modal will fetch summary/description and pre-fill the prompt. Lands with B7 in Phase 7." }) : /* @__PURE__ */ u3(PlaceholderTab, { title: "Spawn from backlog", hint: "Pick from the project's open backlog as a list, optionally batch-spawn. Lands with B7 in Phase 7." }) })
  ] }) });
}
function ManualTab({ onClose, onSpawned }) {
  const [args, setArgs] = d2({
    ticket: "",
    slug: "",
    prompt: "",
    full_auto: true
  });
  const [submitting, setSubmitting] = d2(false);
  const [err, setErr] = d2(null);
  const [estimate, setEstimate] = d2(null);
  y2(() => {
    if (!args.prompt.trim()) {
      setEstimate(null);
      return;
    }
    let cancel = false;
    const id = window.setTimeout(async () => {
      try {
        const r3 = await estimateCost(args.prompt, !!args.full_auto);
        if (!cancel) setEstimate(r3);
      } catch {
      }
    }, 400);
    return () => {
      cancel = true;
      window.clearTimeout(id);
    };
  }, [args.prompt, args.full_auto]);
  const valid = /^[A-Z][A-Z0-9]+-\d+$/.test(args.ticket.trim()) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(args.slug.trim()) && args.prompt.trim().length > 0;
  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const r3 = await spawnFeature({
        ticket: args.ticket.trim(),
        slug: args.slug.trim(),
        prompt: args.prompt,
        full_auto: args.full_auto,
        parent: args.parent?.trim() || void 0,
        max_depth: args.max_depth || void 0
      });
      onSpawned?.(r3.ticket);
      onClose();
    } catch (e3) {
      setErr(e3.message);
    } finally {
      setSubmitting(false);
    }
  }
  return /* @__PURE__ */ u3(
    "form",
    {
      class: "spawn-form",
      onSubmit: (e3) => {
        e3.preventDefault();
        if (valid && !submitting) submit();
      },
      children: [
        /* @__PURE__ */ u3("div", { class: "spawn-form__row", children: [
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("span", { class: "spawn-form__label", children: "Ticket" }),
            /* @__PURE__ */ u3(
              "input",
              {
                class: "spawn-form__input",
                type: "text",
                placeholder: "BDM-99",
                value: args.ticket,
                onInput: (e3) => setArgs({ ...args, ticket: e3.currentTarget.value }),
                autoFocus: true
              }
            )
          ] }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("span", { class: "spawn-form__label", children: "Slug" }),
            /* @__PURE__ */ u3(
              "input",
              {
                class: "spawn-form__input",
                type: "text",
                placeholder: "fix-login-redirect",
                value: args.slug,
                onInput: (e3) => setArgs({ ...args, slug: e3.currentTarget.value })
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ u3("label", { children: [
          /* @__PURE__ */ u3("span", { class: "spawn-form__label", children: "Prompt" }),
          /* @__PURE__ */ u3(
            "textarea",
            {
              class: "spawn-form__textarea",
              rows: 8,
              placeholder: "Describe what the agent should do\u2026",
              value: args.prompt,
              onInput: (e3) => setArgs({ ...args, prompt: e3.currentTarget.value })
            }
          )
        ] }),
        /* @__PURE__ */ u3("div", { class: "spawn-form__row", children: [
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("span", { class: "spawn-form__label", children: "Parent (optional)" }),
            /* @__PURE__ */ u3(
              "input",
              {
                class: "spawn-form__input",
                type: "text",
                placeholder: "BDM-14",
                value: args.parent ?? "",
                onInput: (e3) => setArgs({ ...args, parent: e3.currentTarget.value })
              }
            )
          ] }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("span", { class: "spawn-form__label", children: "Max depth" }),
            /* @__PURE__ */ u3(
              "input",
              {
                class: "spawn-form__input",
                type: "number",
                min: 0,
                max: 5,
                value: args.max_depth ?? "",
                onInput: (e3) => {
                  const v3 = e3.currentTarget.value;
                  setArgs({ ...args, max_depth: v3 ? Number(v3) : void 0 });
                }
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ u3("label", { class: "spawn-form__check", children: [
          /* @__PURE__ */ u3(
            "input",
            {
              type: "checkbox",
              checked: !!args.full_auto,
              onChange: (e3) => setArgs({ ...args, full_auto: e3.currentTarget.checked })
            }
          ),
          /* @__PURE__ */ u3("span", { children: "--full-auto (skip per-step permission gate; recommended for autonomous runs)" })
        ] }),
        estimate ? /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }, children: [
          "Estimated cost: ",
          /* @__PURE__ */ u3("strong", { children: [
            "$",
            estimate.low.toFixed(2)
          ] }),
          " \u2013 ",
          /* @__PURE__ */ u3("strong", { children: [
            "$",
            estimate.high.toFixed(2)
          ] }),
          " ",
          /* @__PURE__ */ u3("span", { style: { color: "var(--color-text-tertiary)" }, children: "(heuristic; Haiku-judged estimate lands later)" })
        ] }) : null,
        err ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)", fontSize: "var(--text-xs)" }, children: err }) : null,
        /* @__PURE__ */ u3("div", { class: "modal__actions", children: [
          /* @__PURE__ */ u3(Button, { onClick: onClose, type: "button", children: "Cancel" }),
          /* @__PURE__ */ u3(Button, { variant: "primary", disabled: !valid || submitting, type: "submit", children: submitting ? "Spawning\u2026" : "Spawn" })
        ] })
      ]
    }
  );
}
function PlaceholderTab({ title, hint }) {
  return /* @__PURE__ */ u3("div", { style: { display: "grid", gap: 12, color: "var(--color-text-secondary)" }, children: [
    /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text-primary)" }, children: title }),
    /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-sm)" }, children: hint }),
    /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }, children: [
      "Use the ",
      /* @__PURE__ */ u3("strong", { children: "Manual" }),
      " tab today; it produces an identical result to ",
      /* @__PURE__ */ u3("code", { children: "spawn-claude-feature" }),
      "."
    ] })
  ] });
}

// src/components/organisms/BroadcastModal.tsx
function BroadcastModal({ onClose }) {
  const [msg, setMsg] = d2("");
  const [submitting, setSubmitting] = d2(false);
  const [err, setErr] = d2(null);
  const [results, setResults] = d2(null);
  return /* @__PURE__ */ u3("div", { class: "modal-backdrop", onClick: onClose, children: /* @__PURE__ */ u3("div", { class: "modal modal--lg", onClick: (e3) => e3.stopPropagation(), children: [
    /* @__PURE__ */ u3("header", { class: "modal__header", children: "Broadcast input to all running sessions" }),
    /* @__PURE__ */ u3("div", { class: "modal__body", children: results == null ? /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("p", { style: { fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }, children: [
        "The same message will be delivered to every session in ",
        /* @__PURE__ */ u3("code", { children: "working" }),
        ",",
        " ",
        /* @__PURE__ */ u3("code", { children: "needs-input" }),
        ", ",
        /* @__PURE__ */ u3("code", { children: "reviewing" }),
        ", or ",
        /* @__PURE__ */ u3("code", { children: "starting" }),
        "."
      ] }),
      /* @__PURE__ */ u3(
        "textarea",
        {
          class: "modal__textarea",
          rows: 6,
          placeholder: "Type the broadcast message\u2026",
          value: msg,
          onInput: (e3) => setMsg(e3.currentTarget.value),
          autoFocus: true
        }
      ),
      err ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)", fontSize: "var(--text-xs)" }, children: err }) : null,
      /* @__PURE__ */ u3("div", { class: "modal__actions", children: [
        /* @__PURE__ */ u3(Button, { onClick: onClose, children: "Cancel" }),
        /* @__PURE__ */ u3(
          Button,
          {
            variant: "primary",
            disabled: !msg.trim() || submitting,
            onClick: async () => {
              setSubmitting(true);
              setErr(null);
              try {
                const r3 = await broadcast(msg);
                setResults(r3);
              } catch (e3) {
                setErr(e3.message);
              } finally {
                setSubmitting(false);
              }
            },
            children: submitting ? "Broadcasting\u2026" : "Broadcast"
          }
        )
      ] })
    ] }) : /* @__PURE__ */ u3(BroadcastResults, { result: results, onClose }) })
  ] }) });
}
function BroadcastResults({ result, onClose }) {
  const ok = result.results.filter((r3) => r3.ok).length;
  const fail = result.results.length - ok;
  return /* @__PURE__ */ u3(S, { children: [
    /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-sm)" }, children: [
      "Delivered to ",
      /* @__PURE__ */ u3("strong", { children: ok }),
      " session",
      ok === 1 ? "" : "s",
      fail > 0 ? `, ${fail} failed` : "",
      "."
    ] }),
    /* @__PURE__ */ u3("ul", { style: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4, maxHeight: 240, overflow: "auto" }, children: result.results.map((r3) => /* @__PURE__ */ u3(
      "li",
      {
        style: {
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-mono)",
          color: r3.ok ? "var(--color-state-done)" : "var(--color-state-error)"
        },
        children: [
          r3.ok ? "\u2713" : "\u2717",
          " ",
          r3.ticket,
          r3.error ? ` \u2014 ${r3.error}` : ""
        ]
      },
      r3.ticket
    )) }),
    /* @__PURE__ */ u3("div", { class: "modal__actions", children: /* @__PURE__ */ u3(Button, { variant: "primary", onClick: onClose, children: "Done" }) })
  ] });
}

// src/components/molecules/ShortcutsOverlay.tsx
var SHORTCUTS = [
  { keys: "?", desc: "Toggle this overlay" },
  { keys: "/", desc: "Focus search" },
  { keys: "g o", desc: "Go to overview" },
  { keys: "d", desc: "Toggle density (compact \u2194 comfortable)" },
  { keys: "n", desc: "New session (open spawn modal)" },
  { keys: "b", desc: "Broadcast input to all running sessions" },
  { keys: "Esc", desc: "Close modals / clear selection" }
];
function ShortcutsOverlay({ onClose }) {
  y2(() => {
    const onKey = (e3) => {
      if (e3.key === "Escape" || e3.key === "?") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return /* @__PURE__ */ u3("div", { class: "modal-backdrop", onClick: onClose, children: /* @__PURE__ */ u3("div", { class: "modal", onClick: (e3) => e3.stopPropagation(), children: [
    /* @__PURE__ */ u3("header", { class: "modal__header", children: "Keyboard shortcuts" }),
    /* @__PURE__ */ u3("div", { class: "modal__body", children: /* @__PURE__ */ u3("table", { class: "kbd-table", children: /* @__PURE__ */ u3("tbody", { children: SHORTCUTS.map((s3) => /* @__PURE__ */ u3("tr", { children: [
      /* @__PURE__ */ u3("td", { children: s3.keys.split(" ").map((k3, i4) => /* @__PURE__ */ u3("span", { children: [
        /* @__PURE__ */ u3("kbd", { class: "kbd", children: k3 }),
        i4 < s3.keys.split(" ").length - 1 ? " " : ""
      ] }, i4)) }),
      /* @__PURE__ */ u3("td", { children: s3.desc })
    ] }, s3.keys)) }) }) })
  ] }) });
}

// src/hooks/useSessionList.ts
var POLL_INTERVAL_MS2 = 5e3;
function useSessionList() {
  return usePolling("/api/sessions", POLL_INTERVAL_MS2, "sessions");
}

// src/hooks/useStats.ts
var POLL_INTERVAL_MS3 = 5e3;
function useStats() {
  return usePolling("/api/stats", POLL_INTERVAL_MS3, "stats");
}

// src/hooks/useShortcuts.ts
var TYPING = /^(input|textarea|select)$/i;
function useShortcuts(b2) {
  y2(() => {
    const handler = (e3) => {
      const t3 = e3.target;
      const isTyping = !!t3 && (TYPING.test(t3.tagName) || t3.isContentEditable);
      if (e3.key === "Escape") {
        b2.onEscape?.();
        return;
      }
      if (isTyping) return;
      switch (e3.key) {
        case "?":
          e3.preventDefault();
          b2.onHelp?.();
          break;
        case "/":
          e3.preventDefault();
          b2.onFocusSearch?.();
          break;
        case "d":
          b2.onToggleDensity?.();
          break;
        case "n":
          b2.onSpawn?.();
          break;
        case "b":
          b2.onBroadcast?.();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [b2]);
}

// src/hooks/usePersistentState.ts
function usePersistentState(key, initial) {
  const [v3, setV] = d2(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  y2(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v3));
    } catch {
    }
  }, [key, v3]);
  return [v3, setV];
}

// src/components/pages/OverviewPage.tsx
function OverviewPage() {
  const stats = useStats();
  const sessions = useSessionList();
  const [version, setVersion] = d2(null);
  const [selected, setSelected] = d2(null);
  const [spawnOpen, setSpawnOpen] = d2(false);
  const [broadcastOpen, setBroadcastOpen] = d2(false);
  const [shortcutsOpen, setShortcutsOpen] = d2(false);
  const [toast, setToast] = d2(null);
  const [density, setDensity] = usePersistentState("fleet.density", "comfortable");
  y2(() => {
    fetchVersion().then(setVersion);
  }, []);
  y2(() => {
    const rows = sessions.data ?? [];
    const active = rows.filter((r3) => ["starting", "working", "reviewing"].includes(r3.state)).length;
    const needs = rows.filter((r3) => ["needs-input", "blocked", "error"].includes(r3.state)).length;
    const proj = version?.project ?? "";
    const parts = [`Fleet`];
    if (rows.length > 0) parts.push(`${active}/${rows.length}`);
    if (needs > 0) parts.push(`${needs} \u26A0`);
    document.title = parts.join(" \xB7 ") + (proj ? ` \u2014 ${proj}` : "");
  }, [sessions.data, version?.project]);
  useShortcuts({
    onHelp: () => setShortcutsOpen((v3) => !v3),
    onFocusSearch: () => {
      const el = document.querySelector(".search-field input");
      el?.focus();
    },
    onToggleDensity: () => setDensity(density === "compact" ? "comfortable" : "compact"),
    onSpawn: () => setSpawnOpen(true),
    onBroadcast: () => setBroadcastOpen(true),
    onEscape: () => {
      if (spawnOpen) setSpawnOpen(false);
      else if (broadcastOpen) setBroadcastOpen(false);
      else if (shortcutsOpen) setShortcutsOpen(false);
      else if (selected) setSelected(null);
    }
  });
  return /* @__PURE__ */ u3(
    AppShell,
    {
      activeView: "overview",
      topBarTitle: "Fleet Overview",
      onSpawnClick: () => setSpawnOpen(true),
      children: [
        /* @__PURE__ */ u3("div", { class: `overview${selected ? " overview--with-detail" : ""}`, children: [
          /* @__PURE__ */ u3("main", { class: "overview__main", children: [
            stats.data ? /* @__PURE__ */ u3(StatRibbon, { stats: stats.data }) : stats.loading ? /* @__PURE__ */ u3("div", { style: { marginBottom: 24, color: "var(--color-text-tertiary)" }, children: "Loading stats\u2026" }) : null,
            sessions.error ? /* @__PURE__ */ u3("div", { style: { marginBottom: 16, color: "var(--color-state-error)" }, children: [
              "Couldn't load sessions: ",
              sessions.error.message
            ] }) : null,
            /* @__PURE__ */ u3(
              SessionTable,
              {
                rows: sessions.data ?? [],
                loading: sessions.loading && !sessions.data,
                density,
                onRowClick: (r3) => setSelected(r3.ticket)
              }
            ),
            /* @__PURE__ */ u3(
              "footer",
              {
                style: {
                  marginTop: 32,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  color: "var(--color-text-tertiary)",
                  fontSize: "var(--text-xs)"
                },
                children: [
                  version ? /* @__PURE__ */ u3("span", { children: [
                    "fleet-web ",
                    version.build,
                    " \xB7 project ",
                    version.project
                  ] }) : null,
                  /* @__PURE__ */ u3("span", { style: { flex: 1 } }),
                  /* @__PURE__ */ u3(
                    "button",
                    {
                      type: "button",
                      class: "link-button",
                      onClick: () => setBroadcastOpen(true),
                      title: "Broadcast input (b)",
                      children: "Broadcast"
                    }
                  ),
                  /* @__PURE__ */ u3(
                    "button",
                    {
                      type: "button",
                      class: "link-button",
                      onClick: () => setDensity(density === "compact" ? "comfortable" : "compact"),
                      title: "Toggle density (d)",
                      children: density === "compact" ? "Comfortable" : "Compact"
                    }
                  ),
                  /* @__PURE__ */ u3(
                    "button",
                    {
                      type: "button",
                      class: "link-button",
                      onClick: () => setShortcutsOpen(true),
                      title: "Shortcuts (?)",
                      children: "? Shortcuts"
                    }
                  )
                ]
              }
            )
          ] }),
          selected ? /* @__PURE__ */ u3(SessionDetailPanel, { ticket: selected, onClose: () => setSelected(null) }) : null
        ] }),
        spawnOpen ? /* @__PURE__ */ u3(
          SpawnModal,
          {
            onClose: () => setSpawnOpen(false),
            onSpawned: (t3) => {
              setToast(`Spawned ${t3}`);
              window.setTimeout(() => setToast(null), 4e3);
            }
          }
        ) : null,
        broadcastOpen ? /* @__PURE__ */ u3(BroadcastModal, { onClose: () => setBroadcastOpen(false) }) : null,
        shortcutsOpen ? /* @__PURE__ */ u3(ShortcutsOverlay, { onClose: () => setShortcutsOpen(false) }) : null,
        toast ? /* @__PURE__ */ u3(
          "div",
          {
            style: {
              position: "fixed",
              bottom: 24,
              right: 24,
              padding: "10px 16px",
              background: "var(--color-state-done)",
              color: "#fff",
              borderRadius: 6,
              fontSize: "var(--text-sm)",
              boxShadow: "var(--shadow-md)",
              zIndex: 100
            },
            children: toast
          }
        ) : null
      ]
    }
  );
}

// src/hooks/useEventStream.ts
var POLL_INTERVAL_MS4 = 5e3;
var LIMIT = 100;
function useEventStream() {
  return usePolling(`/api/events?limit=${LIMIT}`, POLL_INTERVAL_MS4, "events");
}

// src/components/pages/AuditPage.tsx
var KIND_TONES = {
  pr_opened: "var(--color-state-working)",
  merge: "var(--color-state-done)",
  review_comment: "var(--color-state-reviewing)",
  review_summary: "var(--color-state-reviewing)",
  commit_pushed: "var(--color-text-secondary)"
};
function AuditPage() {
  const evts = useEventStream();
  const [q2, setQ] = d2("");
  const filtered = T2(() => {
    const list = evts.data ?? [];
    const needle = q2.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (e3) => e3.ticket.toLowerCase().includes(needle) || e3.kind.toLowerCase().includes(needle) || JSON.stringify(e3.detail).toLowerCase().includes(needle)
    );
  }, [evts.data, q2]);
  return /* @__PURE__ */ u3(AppShell, { activeView: "audit", topBarTitle: "Audit log", children: [
    /* @__PURE__ */ u3("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }, children: [
      /* @__PURE__ */ u3("h2", { style: { margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }, children: "Audit log" }),
      /* @__PURE__ */ u3("span", { style: { flex: 1 } }),
      /* @__PURE__ */ u3("span", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }, children: [
        filtered.length,
        " / ",
        (evts.data ?? []).length
      ] }),
      /* @__PURE__ */ u3("div", { style: { width: 280 }, children: /* @__PURE__ */ u3(SearchField, { placeholder: "Filter ticket / kind / detail\u2026", onChange: setQ }) })
    ] }),
    evts.error ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)" }, children: [
      "Couldn't load events: ",
      evts.error.message
    ] }) : evts.loading && !evts.data ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: "Loading\u2026" }) : filtered.length === 0 ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: "No events match the current filter. Audit feed is sourced from the per-session events JSONL files." }) : /* @__PURE__ */ u3("ol", { class: "audit-list", children: filtered.map((e3) => /* @__PURE__ */ u3("li", { class: "audit-list__row", children: [
      /* @__PURE__ */ u3("div", { class: "audit-list__time", title: e3.id, children: formatTime(e3.ts) }),
      /* @__PURE__ */ u3("div", { class: "audit-list__ticket", children: e3.ticket }),
      /* @__PURE__ */ u3("div", { class: "audit-list__kind", style: { color: KIND_TONES[e3.kind] ?? "var(--color-text-secondary)" }, children: e3.kind }),
      /* @__PURE__ */ u3("div", { class: "audit-list__detail", children: /* @__PURE__ */ u3("code", { style: { fontSize: "var(--text-xs)" }, children: summarize(e3.detail) }) })
    ] }, e3.id)) })
  ] });
}
function formatTime(ts) {
  const d3 = new Date(ts);
  if (Number.isNaN(d3.getTime())) return String(ts);
  return d3.toLocaleString();
}
function summarize(detail) {
  const keys = Object.keys(detail);
  if (keys.length === 0) return "";
  const parts = keys.slice(0, 4).map((k3) => {
    const v3 = detail[k3];
    const s3 = typeof v3 === "string" ? v3 : JSON.stringify(v3);
    const trim = s3.length > 60 ? s3.slice(0, 57) + "\u2026" : s3;
    return `${k3}=${trim}`;
  });
  return parts.join(" \xB7 ");
}

// src/hooks/useRoute.ts
function parseHash(h3) {
  const path = (h3 || "").replace(/^#\/?/, "");
  if (!path || path === "/") return { name: "overview", params: {} };
  if (path === "audit") return { name: "audit", params: {} };
  if (path === "settings") return { name: "settings", params: {} };
  const m3 = /^sessions\/([^/]+)\/replay$/.exec(path);
  if (m3) return { name: "replay", params: { ticket: decodeURIComponent(m3[1]) } };
  return { name: "overview", params: {} };
}
function useRoute() {
  const [route, setRoute] = d2(() => parseHash(window.location.hash));
  y2(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (path) => {
    window.location.hash = path.startsWith("#") ? path : `#${path}`;
  };
  return [route, navigate];
}

// src/components/pages/ReplayPage.tsx
var FETCH_BYTES = 256 * 1024;
function ReplayPage() {
  const [, navigate] = useRoute();
  const route = parseTicketRoute();
  const [log, setLog] = d2(null);
  const [error, setError] = d2(null);
  const [events, setEvents] = d2([]);
  const [position, setPosition] = d2(0);
  const [playing, setPlaying] = d2(false);
  const [speed, setSpeed] = d2(1);
  const playRef = A2(null);
  const lines = T2(() => log == null ? [] : log.split("\n"), [log]);
  y2(() => {
    if (!route.ticket) return;
    const ac = new AbortController();
    fetch(`/api/sessions/${encodeURIComponent(route.ticket)}/log?bytes=${FETCH_BYTES}`, { signal: ac.signal }).then((r3) => r3.ok ? r3.text() : Promise.reject(new Error(`${r3.status} ${r3.statusText}`))).then((txt) => {
      setLog(txt);
      setPosition(txt.split("\n").length - 1);
    }).catch((e3) => {
      if (e3.name !== "AbortError") setError(e3.message);
    });
    fetch(`/api/events?limit=200`, { signal: ac.signal }).then((r3) => r3.ok ? r3.json() : Promise.reject(new Error(`${r3.status} ${r3.statusText}`))).then((all) => setEvents(all.filter((e3) => e3.ticket === route.ticket))).catch(() => {
    });
    return () => ac.abort();
  }, [route.ticket]);
  y2(() => {
    if (!playing) return;
    const ms = Math.max(20, 200 / speed);
    playRef.current = window.setInterval(() => {
      setPosition((p3) => {
        if (p3 >= lines.length - 1) {
          setPlaying(false);
          return p3;
        }
        return p3 + 1;
      });
    }, ms);
    return () => {
      if (playRef.current != null) window.clearInterval(playRef.current);
      playRef.current = null;
    };
  }, [playing, speed, lines.length]);
  if (!route.ticket) {
    return /* @__PURE__ */ u3(AppShell, { activeView: "sessions", topBarTitle: "Replay", children: /* @__PURE__ */ u3("div", { children: "No ticket in route. Navigate from the session detail panel." }) });
  }
  return /* @__PURE__ */ u3(AppShell, { activeView: "sessions", topBarTitle: `Replay \u2014 ${route.ticket}`, children: [
    /* @__PURE__ */ u3("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }, children: [
      /* @__PURE__ */ u3(Button, { onClick: () => navigate("/"), children: "\u2190 Back to overview" }),
      /* @__PURE__ */ u3("span", { style: { flex: 1 } }),
      /* @__PURE__ */ u3(Button, { onClick: () => setPlaying((p3) => !p3), disabled: lines.length === 0, children: playing ? "\u23F8 Pause" : "\u25B6 Play" }),
      /* @__PURE__ */ u3("span", { style: { display: "inline-flex", gap: 4 }, role: "group", "aria-label": "Speed", children: [0.5, 1, 2, 4].map((s3) => /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: `filter-chip${s3 === speed ? " filter-chip--active" : ""}`,
          onClick: () => setSpeed(s3),
          children: [
            s3,
            "x"
          ]
        },
        s3
      )) })
    ] }),
    error ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)" }, children: [
      "Couldn't load log: ",
      error
    ] }) : null,
    /* @__PURE__ */ u3("div", { class: "replay", children: [
      /* @__PURE__ */ u3("pre", { class: "replay__terminal", "aria-label": "Replay terminal", children: lines.slice(0, position + 1).join("\n") }),
      /* @__PURE__ */ u3(
        "input",
        {
          class: "replay__scrub",
          type: "range",
          min: 0,
          max: Math.max(0, lines.length - 1),
          value: position,
          onInput: (e3) => {
            setPlaying(false);
            setPosition(Number(e3.currentTarget.value));
          },
          "aria-label": "Scrub timeline"
        }
      ),
      /* @__PURE__ */ u3("div", { class: "replay__meta", children: [
        /* @__PURE__ */ u3("span", { children: [
          "line ",
          position + 1,
          " / ",
          lines.length
        ] }),
        events.length > 0 ? /* @__PURE__ */ u3("span", { style: { marginLeft: 16 }, children: [
          events.length,
          " event",
          events.length === 1 ? "" : "s"
        ] }) : null
      ] }),
      events.length > 0 ? /* @__PURE__ */ u3("ol", { class: "replay__events", children: events.map((e3, i4) => /* @__PURE__ */ u3("li", { class: "replay__event", children: /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "link-button",
          onClick: () => {
            const target = Math.round((i4 + 1) / events.length * (lines.length - 1));
            setPlaying(false);
            setPosition(target);
          },
          children: [
            /* @__PURE__ */ u3("span", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }, children: new Date(e3.ts).toLocaleTimeString() }),
            " ",
            /* @__PURE__ */ u3("strong", { children: e3.kind })
          ]
        }
      ) }, e3.id)) }) : null
    ] })
  ] });
}
function parseTicketRoute() {
  const m3 = /^#\/?sessions\/([^/]+)\/replay$/.exec(window.location.hash);
  return { ticket: m3 ? decodeURIComponent(m3[1]) : null };
}

// src/hooks/useTheme.ts
var DEFAULT = { theme: "light", accent: "#2563eb", font: "inter" };
function useTheme() {
  const [state, setState] = usePersistentState("fleet.theme", DEFAULT);
  y2(() => {
    const html = document.documentElement;
    if (state.theme === "light") html.removeAttribute("data-theme");
    else html.setAttribute("data-theme", state.theme);
    if (state.font === "inter") html.removeAttribute("data-font");
    else html.setAttribute("data-font", state.font);
    if (state.accent) html.style.setProperty("--color-accent", state.accent);
  }, [state]);
  return [state, setState];
}

// src/components/pages/SettingsPage.tsx
var THEME_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "repllt-blue", label: "Repllt Blue" }
];
var ACCENTS = ["#2563eb", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#0f172a"];
var FONT_OPTIONS = [
  { id: "inter", label: "Inter (default)" },
  { id: "jetbrains-mono", label: "JetBrains Mono" },
  { id: "system", label: "System" }
];
function SettingsPage() {
  const [s3, setS] = d2(null);
  const [err, setErr] = d2(null);
  const [saving, setSaving] = d2(false);
  const [savedAt, setSavedAt] = d2(null);
  const [theme, setTheme] = useTheme();
  y2(() => {
    loadSettings().then(setS).catch((e3) => setErr(e3.message));
  }, []);
  async function persist() {
    if (!s3) return;
    setSaving(true);
    setErr(null);
    try {
      const merged = {
        ...s3,
        theme: { theme: theme.theme, accent: theme.accent, font: theme.font }
      };
      const next = await saveSettings(merged);
      setS(next);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2500);
    } catch (e3) {
      setErr(e3.message);
    } finally {
      setSaving(false);
    }
  }
  return /* @__PURE__ */ u3(AppShell, { activeView: "settings", topBarTitle: "Settings", children: [
    err ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)", marginBottom: 12 }, children: err }) : null,
    !s3 ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: "Loading settings\u2026" }) : /* @__PURE__ */ u3("div", { class: "settings", children: [
      /* @__PURE__ */ u3(Section, { title: "Mobile push (B15)", children: [
        /* @__PURE__ */ u3("p", { style: { fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }, children: [
          "Routes selected event kinds to an ",
          /* @__PURE__ */ u3("code", { children: "ntfy" }),
          " topic. The notify daemon already supports webhook sinks; this page persists the config."
        ] }),
        /* @__PURE__ */ u3(Field, { label: "Enabled", children: /* @__PURE__ */ u3(
          "input",
          {
            type: "checkbox",
            checked: s3.mobile.enabled,
            onChange: (e3) => setS({ ...s3, mobile: { ...s3.mobile, enabled: e3.currentTarget.checked } })
          }
        ) }),
        /* @__PURE__ */ u3(Field, { label: "ntfy URL", children: /* @__PURE__ */ u3(
          "input",
          {
            class: "settings__input",
            type: "url",
            value: s3.mobile.ntfy_url,
            placeholder: "https://ntfy.sh",
            onInput: (e3) => setS({ ...s3, mobile: { ...s3.mobile, ntfy_url: e3.currentTarget.value } })
          }
        ) }),
        /* @__PURE__ */ u3(Field, { label: "Topic", children: /* @__PURE__ */ u3(
          "input",
          {
            class: "settings__input",
            type: "text",
            placeholder: "fleet-alerts-abc123",
            value: s3.mobile.topic,
            onInput: (e3) => setS({ ...s3, mobile: { ...s3.mobile, topic: e3.currentTarget.value } })
          }
        ) }),
        /* @__PURE__ */ u3(Field, { label: "Kinds (comma-separated)", children: /* @__PURE__ */ u3(
          "input",
          {
            class: "settings__input",
            type: "text",
            placeholder: "merge,pr_opened,review_summary",
            value: s3.mobile.kinds,
            onInput: (e3) => setS({ ...s3, mobile: { ...s3.mobile, kinds: e3.currentTarget.value } })
          }
        ) }),
        s3.mobile.enabled && s3.mobile.topic ? /* @__PURE__ */ u3(CodeBlock, { children: `curl -d "fleet event" ${s3.mobile.ntfy_url.replace(/\/$/, "")}/${s3.mobile.topic}` }) : null
      ] }),
      /* @__PURE__ */ u3(Section, { title: "Theme (C7)", children: [
        /* @__PURE__ */ u3("p", { style: { fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }, children: [
          "Live preview \u2014 changes apply to this browser immediately. Saving persists them to the project's ",
          /* @__PURE__ */ u3("code", { children: "settings.toml" }),
          "."
        ] }),
        /* @__PURE__ */ u3(Field, { label: "Theme", children: /* @__PURE__ */ u3("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: THEME_OPTIONS.map((opt) => /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            class: `filter-chip${theme.theme === opt.id ? " filter-chip--active" : ""}`,
            onClick: () => setTheme({ ...theme, theme: opt.id }),
            children: opt.label
          },
          opt.id
        )) }) }),
        /* @__PURE__ */ u3(Field, { label: "Accent color", children: /* @__PURE__ */ u3("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: ACCENTS.map((hex) => /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            "aria-label": hex,
            onClick: () => setTheme({ ...theme, accent: hex }),
            style: {
              width: 24,
              height: 24,
              borderRadius: 6,
              border: "2px solid",
              borderColor: theme.accent === hex ? "var(--color-text-primary)" : "var(--color-border)",
              background: hex,
              cursor: "pointer"
            }
          },
          hex
        )) }) }),
        /* @__PURE__ */ u3(Field, { label: "Font", children: /* @__PURE__ */ u3(
          "select",
          {
            class: "settings__input",
            value: theme.font,
            onChange: (e3) => setTheme({ ...theme, font: e3.currentTarget.value }),
            children: FONT_OPTIONS.map((opt) => /* @__PURE__ */ u3("option", { value: opt.id, children: opt.label }, opt.id))
          }
        ) })
      ] }),
      /* @__PURE__ */ u3(Section, { title: "Tailscale share (B17)", children: [
        /* @__PURE__ */ u3("p", { style: { fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }, children: [
          "Expose this dashboard over your tailnet (or the public internet via funnel). The toggle is informational \u2014 you still run the ",
          /* @__PURE__ */ u3("code", { children: "tailscale" }),
          " CLI yourself."
        ] }),
        /* @__PURE__ */ u3(Field, { label: "Enabled", children: /* @__PURE__ */ u3(
          "input",
          {
            type: "checkbox",
            checked: s3.tailscale.enabled,
            onChange: (e3) => setS({ ...s3, tailscale: { ...s3.tailscale, enabled: e3.currentTarget.checked } })
          }
        ) }),
        /* @__PURE__ */ u3(Field, { label: "Use funnel (public)", children: /* @__PURE__ */ u3(
          "input",
          {
            type: "checkbox",
            checked: s3.tailscale.funnel,
            onChange: (e3) => setS({ ...s3, tailscale: { ...s3.tailscale, funnel: e3.currentTarget.checked } })
          }
        ) }),
        s3.tailscale.enabled ? /* @__PURE__ */ u3(CodeBlock, { children: s3.tailscale.funnel ? `tailscale funnel --bg ${window.location.origin}` : `tailscale serve --bg ${window.location.origin}` }) : null
      ] }),
      /* @__PURE__ */ u3("div", { class: "modal__actions", style: { justifyContent: "flex-start" }, children: [
        /* @__PURE__ */ u3(Button, { variant: "primary", onClick: persist, disabled: saving, children: saving ? "Saving\u2026" : "Save" }),
        savedAt ? /* @__PURE__ */ u3("span", { style: { fontSize: "var(--text-xs)", color: "var(--color-state-done)" }, children: "Saved." }) : null
      ] })
    ] })
  ] });
}
function Section({ title, children }) {
  return /* @__PURE__ */ u3("section", { class: "settings__section", children: [
    /* @__PURE__ */ u3("h2", { class: "settings__section-title", children: title }),
    /* @__PURE__ */ u3("div", { class: "settings__rows", children })
  ] });
}
function Field({ label, children }) {
  return /* @__PURE__ */ u3("label", { class: "settings__field", children: [
    /* @__PURE__ */ u3("span", { class: "settings__label", children: label }),
    /* @__PURE__ */ u3("span", { class: "settings__control", children })
  ] });
}
function CodeBlock({ children }) {
  return /* @__PURE__ */ u3("pre", { style: {
    background: "#0b0e14",
    color: "#d4d4d4",
    padding: "var(--space-3)",
    borderRadius: "var(--radius-md)",
    fontSize: "var(--text-xs)",
    fontFamily: "var(--font-mono)",
    overflow: "auto",
    margin: "var(--space-2) 0 0"
  }, children });
}

// src/main.tsx
function App() {
  useTheme();
  const [route] = useRoute();
  switch (route.name) {
    case "audit":
      return /* @__PURE__ */ u3(AuditPage, {});
    case "replay":
      return /* @__PURE__ */ u3(ReplayPage, {});
    case "settings":
      return /* @__PURE__ */ u3(SettingsPage, {});
    default:
      return /* @__PURE__ */ u3(OverviewPage, {});
  }
}
var rootEl = document.getElementById("root");
if (rootEl) {
  R(/* @__PURE__ */ u3(App, {}), rootEl);
} else {
  console.error("fleet-web: #root not found in DOM");
}
try {
  const es = new EventSource("/api/stream?topics=dist-rebuilt");
  es.addEventListener("dist-rebuilt", () => {
    console.log("[fleet-dev] dist rebuilt; reloading");
    window.location.reload();
  });
} catch {
}
//# sourceMappingURL=app.js.map
