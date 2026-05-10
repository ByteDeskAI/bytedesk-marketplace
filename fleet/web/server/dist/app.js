var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@xterm/xterm/lib/xterm.js
var require_xterm = __commonJS({
  "node_modules/@xterm/xterm/lib/xterm.js"(exports, module) {
    !function(e3, t3) {
      if ("object" == typeof exports && "object" == typeof module) module.exports = t3();
      else if ("function" == typeof define && define.amd) define([], t3);
      else {
        var i4 = t3();
        for (var s3 in i4) ("object" == typeof exports ? exports : e3)[s3] = i4[s3];
      }
    }(globalThis, () => (() => {
      "use strict";
      var e3 = { 4567: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.AccessibilityManager = void 0;
        const n2 = i5(9042), o3 = i5(9924), a3 = i5(844), h3 = i5(4725), c3 = i5(2585), l3 = i5(3656);
        let d3 = t4.AccessibilityManager = class extends a3.Disposable {
          constructor(e5, t5, i6, s5) {
            super(), this._terminal = e5, this._coreBrowserService = i6, this._renderService = s5, this._rowColumns = /* @__PURE__ */ new WeakMap(), this._liveRegionLineCount = 0, this._charsToConsume = [], this._charsToAnnounce = "", this._accessibilityContainer = this._coreBrowserService.mainDocument.createElement("div"), this._accessibilityContainer.classList.add("xterm-accessibility"), this._rowContainer = this._coreBrowserService.mainDocument.createElement("div"), this._rowContainer.setAttribute("role", "list"), this._rowContainer.classList.add("xterm-accessibility-tree"), this._rowElements = [];
            for (let e6 = 0; e6 < this._terminal.rows; e6++) this._rowElements[e6] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e6]);
            if (this._topBoundaryFocusListener = (e6) => this._handleBoundaryFocus(e6, 0), this._bottomBoundaryFocusListener = (e6) => this._handleBoundaryFocus(e6, 1), this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions(), this._accessibilityContainer.appendChild(this._rowContainer), this._liveRegion = this._coreBrowserService.mainDocument.createElement("div"), this._liveRegion.classList.add("live-region"), this._liveRegion.setAttribute("aria-live", "assertive"), this._accessibilityContainer.appendChild(this._liveRegion), this._liveRegionDebouncer = this.register(new o3.TimeBasedDebouncer(this._renderRows.bind(this))), !this._terminal.element) throw new Error("Cannot enable accessibility before Terminal.open");
            this._terminal.element.insertAdjacentElement("afterbegin", this._accessibilityContainer), this.register(this._terminal.onResize((e6) => this._handleResize(e6.rows))), this.register(this._terminal.onRender((e6) => this._refreshRows(e6.start, e6.end))), this.register(this._terminal.onScroll(() => this._refreshRows())), this.register(this._terminal.onA11yChar((e6) => this._handleChar(e6))), this.register(this._terminal.onLineFeed(() => this._handleChar("\n"))), this.register(this._terminal.onA11yTab((e6) => this._handleTab(e6))), this.register(this._terminal.onKey((e6) => this._handleKey(e6.key))), this.register(this._terminal.onBlur(() => this._clearLiveRegion())), this.register(this._renderService.onDimensionsChange(() => this._refreshRowsDimensions())), this.register((0, l3.addDisposableDomListener)(document, "selectionchange", () => this._handleSelectionChange())), this.register(this._coreBrowserService.onDprChange(() => this._refreshRowsDimensions())), this._refreshRows(), this.register((0, a3.toDisposable)(() => {
              this._accessibilityContainer.remove(), this._rowElements.length = 0;
            }));
          }
          _handleTab(e5) {
            for (let t5 = 0; t5 < e5; t5++) this._handleChar(" ");
          }
          _handleChar(e5) {
            this._liveRegionLineCount < 21 && (this._charsToConsume.length > 0 ? this._charsToConsume.shift() !== e5 && (this._charsToAnnounce += e5) : this._charsToAnnounce += e5, "\n" === e5 && (this._liveRegionLineCount++, 21 === this._liveRegionLineCount && (this._liveRegion.textContent += n2.tooMuchOutput)));
          }
          _clearLiveRegion() {
            this._liveRegion.textContent = "", this._liveRegionLineCount = 0;
          }
          _handleKey(e5) {
            this._clearLiveRegion(), /\p{Control}/u.test(e5) || this._charsToConsume.push(e5);
          }
          _refreshRows(e5, t5) {
            this._liveRegionDebouncer.refresh(e5, t5, this._terminal.rows);
          }
          _renderRows(e5, t5) {
            const i6 = this._terminal.buffer, s5 = i6.lines.length.toString();
            for (let r4 = e5; r4 <= t5; r4++) {
              const e6 = i6.lines.get(i6.ydisp + r4), t6 = [], n3 = e6?.translateToString(true, void 0, void 0, t6) || "", o4 = (i6.ydisp + r4 + 1).toString(), a4 = this._rowElements[r4];
              a4 && (0 === n3.length ? (a4.innerText = "\xA0", this._rowColumns.set(a4, [0, 1])) : (a4.textContent = n3, this._rowColumns.set(a4, t6)), a4.setAttribute("aria-posinset", o4), a4.setAttribute("aria-setsize", s5));
            }
            this._announceCharacters();
          }
          _announceCharacters() {
            0 !== this._charsToAnnounce.length && (this._liveRegion.textContent += this._charsToAnnounce, this._charsToAnnounce = "");
          }
          _handleBoundaryFocus(e5, t5) {
            const i6 = e5.target, s5 = this._rowElements[0 === t5 ? 1 : this._rowElements.length - 2];
            if (i6.getAttribute("aria-posinset") === (0 === t5 ? "1" : `${this._terminal.buffer.lines.length}`)) return;
            if (e5.relatedTarget !== s5) return;
            let r4, n3;
            if (0 === t5 ? (r4 = i6, n3 = this._rowElements.pop(), this._rowContainer.removeChild(n3)) : (r4 = this._rowElements.shift(), n3 = i6, this._rowContainer.removeChild(r4)), r4.removeEventListener("focus", this._topBoundaryFocusListener), n3.removeEventListener("focus", this._bottomBoundaryFocusListener), 0 === t5) {
              const e6 = this._createAccessibilityTreeNode();
              this._rowElements.unshift(e6), this._rowContainer.insertAdjacentElement("afterbegin", e6);
            } else {
              const e6 = this._createAccessibilityTreeNode();
              this._rowElements.push(e6), this._rowContainer.appendChild(e6);
            }
            this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._terminal.scrollLines(0 === t5 ? -1 : 1), this._rowElements[0 === t5 ? 1 : this._rowElements.length - 2].focus(), e5.preventDefault(), e5.stopImmediatePropagation();
          }
          _handleSelectionChange() {
            if (0 === this._rowElements.length) return;
            const e5 = document.getSelection();
            if (!e5) return;
            if (e5.isCollapsed) return void (this._rowContainer.contains(e5.anchorNode) && this._terminal.clearSelection());
            if (!e5.anchorNode || !e5.focusNode) return void console.error("anchorNode and/or focusNode are null");
            let t5 = { node: e5.anchorNode, offset: e5.anchorOffset }, i6 = { node: e5.focusNode, offset: e5.focusOffset };
            if ((t5.node.compareDocumentPosition(i6.node) & Node.DOCUMENT_POSITION_PRECEDING || t5.node === i6.node && t5.offset > i6.offset) && ([t5, i6] = [i6, t5]), t5.node.compareDocumentPosition(this._rowElements[0]) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING) && (t5 = { node: this._rowElements[0].childNodes[0], offset: 0 }), !this._rowContainer.contains(t5.node)) return;
            const s5 = this._rowElements.slice(-1)[0];
            if (i6.node.compareDocumentPosition(s5) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_PRECEDING) && (i6 = { node: s5, offset: s5.textContent?.length ?? 0 }), !this._rowContainer.contains(i6.node)) return;
            const r4 = ({ node: e6, offset: t6 }) => {
              const i7 = e6 instanceof Text ? e6.parentNode : e6;
              let s6 = parseInt(i7?.getAttribute("aria-posinset"), 10) - 1;
              if (isNaN(s6)) return console.warn("row is invalid. Race condition?"), null;
              const r5 = this._rowColumns.get(i7);
              if (!r5) return console.warn("columns is null. Race condition?"), null;
              let n4 = t6 < r5.length ? r5[t6] : r5.slice(-1)[0] + 1;
              return n4 >= this._terminal.cols && (++s6, n4 = 0), { row: s6, column: n4 };
            }, n3 = r4(t5), o4 = r4(i6);
            if (n3 && o4) {
              if (n3.row > o4.row || n3.row === o4.row && n3.column >= o4.column) throw new Error("invalid range");
              this._terminal.select(n3.column, n3.row, (o4.row - n3.row) * this._terminal.cols - n3.column + o4.column);
            }
          }
          _handleResize(e5) {
            this._rowElements[this._rowElements.length - 1].removeEventListener("focus", this._bottomBoundaryFocusListener);
            for (let e6 = this._rowContainer.children.length; e6 < this._terminal.rows; e6++) this._rowElements[e6] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e6]);
            for (; this._rowElements.length > e5; ) this._rowContainer.removeChild(this._rowElements.pop());
            this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions();
          }
          _createAccessibilityTreeNode() {
            const e5 = this._coreBrowserService.mainDocument.createElement("div");
            return e5.setAttribute("role", "listitem"), e5.tabIndex = -1, this._refreshRowDimensions(e5), e5;
          }
          _refreshRowsDimensions() {
            if (this._renderService.dimensions.css.cell.height) {
              this._accessibilityContainer.style.width = `${this._renderService.dimensions.css.canvas.width}px`, this._rowElements.length !== this._terminal.rows && this._handleResize(this._terminal.rows);
              for (let e5 = 0; e5 < this._terminal.rows; e5++) this._refreshRowDimensions(this._rowElements[e5]);
            }
          }
          _refreshRowDimensions(e5) {
            e5.style.height = `${this._renderService.dimensions.css.cell.height}px`;
          }
        };
        t4.AccessibilityManager = d3 = s4([r3(1, c3.IInstantiationService), r3(2, h3.ICoreBrowserService), r3(3, h3.IRenderService)], d3);
      }, 3614: (e4, t4) => {
        function i5(e5) {
          return e5.replace(/\r?\n/g, "\r");
        }
        function s4(e5, t5) {
          return t5 ? "\x1B[200~" + e5 + "\x1B[201~" : e5;
        }
        function r3(e5, t5, r4, n3) {
          e5 = s4(e5 = i5(e5), r4.decPrivateModes.bracketedPasteMode && true !== n3.rawOptions.ignoreBracketedPasteMode), r4.triggerDataEvent(e5, true), t5.value = "";
        }
        function n2(e5, t5, i6) {
          const s5 = i6.getBoundingClientRect(), r4 = e5.clientX - s5.left - 10, n3 = e5.clientY - s5.top - 10;
          t5.style.width = "20px", t5.style.height = "20px", t5.style.left = `${r4}px`, t5.style.top = `${n3}px`, t5.style.zIndex = "1000", t5.focus();
        }
        Object.defineProperty(t4, "__esModule", { value: true }), t4.rightClickHandler = t4.moveTextAreaUnderMouseCursor = t4.paste = t4.handlePasteEvent = t4.copyHandler = t4.bracketTextForPaste = t4.prepareTextForTerminal = void 0, t4.prepareTextForTerminal = i5, t4.bracketTextForPaste = s4, t4.copyHandler = function(e5, t5) {
          e5.clipboardData && e5.clipboardData.setData("text/plain", t5.selectionText), e5.preventDefault();
        }, t4.handlePasteEvent = function(e5, t5, i6, s5) {
          e5.stopPropagation(), e5.clipboardData && r3(e5.clipboardData.getData("text/plain"), t5, i6, s5);
        }, t4.paste = r3, t4.moveTextAreaUnderMouseCursor = n2, t4.rightClickHandler = function(e5, t5, i6, s5, r4) {
          n2(e5, t5, i6), r4 && s5.rightClickSelect(e5), t5.value = s5.selectionText, t5.select();
        };
      }, 7239: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.ColorContrastCache = void 0;
        const s4 = i5(1505);
        t4.ColorContrastCache = class {
          constructor() {
            this._color = new s4.TwoKeyMap(), this._css = new s4.TwoKeyMap();
          }
          setCss(e5, t5, i6) {
            this._css.set(e5, t5, i6);
          }
          getCss(e5, t5) {
            return this._css.get(e5, t5);
          }
          setColor(e5, t5, i6) {
            this._color.set(e5, t5, i6);
          }
          getColor(e5, t5) {
            return this._color.get(e5, t5);
          }
          clear() {
            this._color.clear(), this._css.clear();
          }
        };
      }, 3656: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.addDisposableDomListener = void 0, t4.addDisposableDomListener = function(e5, t5, i5, s4) {
          e5.addEventListener(t5, i5, s4);
          let r3 = false;
          return { dispose: () => {
            r3 || (r3 = true, e5.removeEventListener(t5, i5, s4));
          } };
        };
      }, 3551: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.Linkifier = void 0;
        const n2 = i5(3656), o3 = i5(8460), a3 = i5(844), h3 = i5(2585), c3 = i5(4725);
        let l3 = t4.Linkifier = class extends a3.Disposable {
          get currentLink() {
            return this._currentLink;
          }
          constructor(e5, t5, i6, s5, r4) {
            super(), this._element = e5, this._mouseService = t5, this._renderService = i6, this._bufferService = s5, this._linkProviderService = r4, this._linkCacheDisposables = [], this._isMouseOut = true, this._wasResized = false, this._activeLine = -1, this._onShowLinkUnderline = this.register(new o3.EventEmitter()), this.onShowLinkUnderline = this._onShowLinkUnderline.event, this._onHideLinkUnderline = this.register(new o3.EventEmitter()), this.onHideLinkUnderline = this._onHideLinkUnderline.event, this.register((0, a3.getDisposeArrayDisposable)(this._linkCacheDisposables)), this.register((0, a3.toDisposable)(() => {
              this._lastMouseEvent = void 0, this._activeProviderReplies?.clear();
            })), this.register(this._bufferService.onResize(() => {
              this._clearCurrentLink(), this._wasResized = true;
            })), this.register((0, n2.addDisposableDomListener)(this._element, "mouseleave", () => {
              this._isMouseOut = true, this._clearCurrentLink();
            })), this.register((0, n2.addDisposableDomListener)(this._element, "mousemove", this._handleMouseMove.bind(this))), this.register((0, n2.addDisposableDomListener)(this._element, "mousedown", this._handleMouseDown.bind(this))), this.register((0, n2.addDisposableDomListener)(this._element, "mouseup", this._handleMouseUp.bind(this)));
          }
          _handleMouseMove(e5) {
            this._lastMouseEvent = e5;
            const t5 = this._positionFromMouseEvent(e5, this._element, this._mouseService);
            if (!t5) return;
            this._isMouseOut = false;
            const i6 = e5.composedPath();
            for (let e6 = 0; e6 < i6.length; e6++) {
              const t6 = i6[e6];
              if (t6.classList.contains("xterm")) break;
              if (t6.classList.contains("xterm-hover")) return;
            }
            this._lastBufferCell && t5.x === this._lastBufferCell.x && t5.y === this._lastBufferCell.y || (this._handleHover(t5), this._lastBufferCell = t5);
          }
          _handleHover(e5) {
            if (this._activeLine !== e5.y || this._wasResized) return this._clearCurrentLink(), this._askForLink(e5, false), void (this._wasResized = false);
            this._currentLink && this._linkAtPosition(this._currentLink.link, e5) || (this._clearCurrentLink(), this._askForLink(e5, true));
          }
          _askForLink(e5, t5) {
            this._activeProviderReplies && t5 || (this._activeProviderReplies?.forEach((e6) => {
              e6?.forEach((e7) => {
                e7.link.dispose && e7.link.dispose();
              });
            }), this._activeProviderReplies = /* @__PURE__ */ new Map(), this._activeLine = e5.y);
            let i6 = false;
            for (const [s5, r4] of this._linkProviderService.linkProviders.entries()) if (t5) {
              const t6 = this._activeProviderReplies?.get(s5);
              t6 && (i6 = this._checkLinkProviderResult(s5, e5, i6));
            } else r4.provideLinks(e5.y, (t6) => {
              if (this._isMouseOut) return;
              const r5 = t6?.map((e6) => ({ link: e6 }));
              this._activeProviderReplies?.set(s5, r5), i6 = this._checkLinkProviderResult(s5, e5, i6), this._activeProviderReplies?.size === this._linkProviderService.linkProviders.length && this._removeIntersectingLinks(e5.y, this._activeProviderReplies);
            });
          }
          _removeIntersectingLinks(e5, t5) {
            const i6 = /* @__PURE__ */ new Set();
            for (let s5 = 0; s5 < t5.size; s5++) {
              const r4 = t5.get(s5);
              if (r4) for (let t6 = 0; t6 < r4.length; t6++) {
                const s6 = r4[t6], n3 = s6.link.range.start.y < e5 ? 0 : s6.link.range.start.x, o4 = s6.link.range.end.y > e5 ? this._bufferService.cols : s6.link.range.end.x;
                for (let e6 = n3; e6 <= o4; e6++) {
                  if (i6.has(e6)) {
                    r4.splice(t6--, 1);
                    break;
                  }
                  i6.add(e6);
                }
              }
            }
          }
          _checkLinkProviderResult(e5, t5, i6) {
            if (!this._activeProviderReplies) return i6;
            const s5 = this._activeProviderReplies.get(e5);
            let r4 = false;
            for (let t6 = 0; t6 < e5; t6++) this._activeProviderReplies.has(t6) && !this._activeProviderReplies.get(t6) || (r4 = true);
            if (!r4 && s5) {
              const e6 = s5.find((e7) => this._linkAtPosition(e7.link, t5));
              e6 && (i6 = true, this._handleNewLink(e6));
            }
            if (this._activeProviderReplies.size === this._linkProviderService.linkProviders.length && !i6) for (let e6 = 0; e6 < this._activeProviderReplies.size; e6++) {
              const s6 = this._activeProviderReplies.get(e6)?.find((e7) => this._linkAtPosition(e7.link, t5));
              if (s6) {
                i6 = true, this._handleNewLink(s6);
                break;
              }
            }
            return i6;
          }
          _handleMouseDown() {
            this._mouseDownLink = this._currentLink;
          }
          _handleMouseUp(e5) {
            if (!this._currentLink) return;
            const t5 = this._positionFromMouseEvent(e5, this._element, this._mouseService);
            t5 && this._mouseDownLink === this._currentLink && this._linkAtPosition(this._currentLink.link, t5) && this._currentLink.link.activate(e5, this._currentLink.link.text);
          }
          _clearCurrentLink(e5, t5) {
            this._currentLink && this._lastMouseEvent && (!e5 || !t5 || this._currentLink.link.range.start.y >= e5 && this._currentLink.link.range.end.y <= t5) && (this._linkLeave(this._element, this._currentLink.link, this._lastMouseEvent), this._currentLink = void 0, (0, a3.disposeArray)(this._linkCacheDisposables));
          }
          _handleNewLink(e5) {
            if (!this._lastMouseEvent) return;
            const t5 = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
            t5 && this._linkAtPosition(e5.link, t5) && (this._currentLink = e5, this._currentLink.state = { decorations: { underline: void 0 === e5.link.decorations || e5.link.decorations.underline, pointerCursor: void 0 === e5.link.decorations || e5.link.decorations.pointerCursor }, isHovered: true }, this._linkHover(this._element, e5.link, this._lastMouseEvent), e5.link.decorations = {}, Object.defineProperties(e5.link.decorations, { pointerCursor: { get: () => this._currentLink?.state?.decorations.pointerCursor, set: (e6) => {
              this._currentLink?.state && this._currentLink.state.decorations.pointerCursor !== e6 && (this._currentLink.state.decorations.pointerCursor = e6, this._currentLink.state.isHovered && this._element.classList.toggle("xterm-cursor-pointer", e6));
            } }, underline: { get: () => this._currentLink?.state?.decorations.underline, set: (t6) => {
              this._currentLink?.state && this._currentLink?.state?.decorations.underline !== t6 && (this._currentLink.state.decorations.underline = t6, this._currentLink.state.isHovered && this._fireUnderlineEvent(e5.link, t6));
            } } }), this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((e6) => {
              if (!this._currentLink) return;
              const t6 = 0 === e6.start ? 0 : e6.start + 1 + this._bufferService.buffer.ydisp, i6 = this._bufferService.buffer.ydisp + 1 + e6.end;
              if (this._currentLink.link.range.start.y >= t6 && this._currentLink.link.range.end.y <= i6 && (this._clearCurrentLink(t6, i6), this._lastMouseEvent)) {
                const e7 = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
                e7 && this._askForLink(e7, false);
              }
            })));
          }
          _linkHover(e5, t5, i6) {
            this._currentLink?.state && (this._currentLink.state.isHovered = true, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t5, true), this._currentLink.state.decorations.pointerCursor && e5.classList.add("xterm-cursor-pointer")), t5.hover && t5.hover(i6, t5.text);
          }
          _fireUnderlineEvent(e5, t5) {
            const i6 = e5.range, s5 = this._bufferService.buffer.ydisp, r4 = this._createLinkUnderlineEvent(i6.start.x - 1, i6.start.y - s5 - 1, i6.end.x, i6.end.y - s5 - 1, void 0);
            (t5 ? this._onShowLinkUnderline : this._onHideLinkUnderline).fire(r4);
          }
          _linkLeave(e5, t5, i6) {
            this._currentLink?.state && (this._currentLink.state.isHovered = false, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t5, false), this._currentLink.state.decorations.pointerCursor && e5.classList.remove("xterm-cursor-pointer")), t5.leave && t5.leave(i6, t5.text);
          }
          _linkAtPosition(e5, t5) {
            const i6 = e5.range.start.y * this._bufferService.cols + e5.range.start.x, s5 = e5.range.end.y * this._bufferService.cols + e5.range.end.x, r4 = t5.y * this._bufferService.cols + t5.x;
            return i6 <= r4 && r4 <= s5;
          }
          _positionFromMouseEvent(e5, t5, i6) {
            const s5 = i6.getCoords(e5, t5, this._bufferService.cols, this._bufferService.rows);
            if (s5) return { x: s5[0], y: s5[1] + this._bufferService.buffer.ydisp };
          }
          _createLinkUnderlineEvent(e5, t5, i6, s5, r4) {
            return { x1: e5, y1: t5, x2: i6, y2: s5, cols: this._bufferService.cols, fg: r4 };
          }
        };
        t4.Linkifier = l3 = s4([r3(1, c3.IMouseService), r3(2, c3.IRenderService), r3(3, h3.IBufferService), r3(4, c3.ILinkProviderService)], l3);
      }, 9042: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.tooMuchOutput = t4.promptLabel = void 0, t4.promptLabel = "Terminal input", t4.tooMuchOutput = "Too much output to announce, navigate to rows manually to read";
      }, 3730: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.OscLinkProvider = void 0;
        const n2 = i5(511), o3 = i5(2585);
        let a3 = t4.OscLinkProvider = class {
          constructor(e5, t5, i6) {
            this._bufferService = e5, this._optionsService = t5, this._oscLinkService = i6;
          }
          provideLinks(e5, t5) {
            const i6 = this._bufferService.buffer.lines.get(e5 - 1);
            if (!i6) return void t5(void 0);
            const s5 = [], r4 = this._optionsService.rawOptions.linkHandler, o4 = new n2.CellData(), a4 = i6.getTrimmedLength();
            let c3 = -1, l3 = -1, d3 = false;
            for (let t6 = 0; t6 < a4; t6++) if (-1 !== l3 || i6.hasContent(t6)) {
              if (i6.loadCell(t6, o4), o4.hasExtendedAttrs() && o4.extended.urlId) {
                if (-1 === l3) {
                  l3 = t6, c3 = o4.extended.urlId;
                  continue;
                }
                d3 = o4.extended.urlId !== c3;
              } else -1 !== l3 && (d3 = true);
              if (d3 || -1 !== l3 && t6 === a4 - 1) {
                const i7 = this._oscLinkService.getLinkData(c3)?.uri;
                if (i7) {
                  const n3 = { start: { x: l3 + 1, y: e5 }, end: { x: t6 + (d3 || t6 !== a4 - 1 ? 0 : 1), y: e5 } };
                  let o5 = false;
                  if (!r4?.allowNonHttpProtocols) try {
                    const e6 = new URL(i7);
                    ["http:", "https:"].includes(e6.protocol) || (o5 = true);
                  } catch (e6) {
                    o5 = true;
                  }
                  o5 || s5.push({ text: i7, range: n3, activate: (e6, t7) => r4 ? r4.activate(e6, t7, n3) : h3(0, t7), hover: (e6, t7) => r4?.hover?.(e6, t7, n3), leave: (e6, t7) => r4?.leave?.(e6, t7, n3) });
                }
                d3 = false, o4.hasExtendedAttrs() && o4.extended.urlId ? (l3 = t6, c3 = o4.extended.urlId) : (l3 = -1, c3 = -1);
              }
            }
            t5(s5);
          }
        };
        function h3(e5, t5) {
          if (confirm(`Do you want to navigate to ${t5}?

WARNING: This link could potentially be dangerous`)) {
            const e6 = window.open();
            if (e6) {
              try {
                e6.opener = null;
              } catch {
              }
              e6.location.href = t5;
            } else console.warn("Opening link blocked as opener could not be cleared");
          }
        }
        t4.OscLinkProvider = a3 = s4([r3(0, o3.IBufferService), r3(1, o3.IOptionsService), r3(2, o3.IOscLinkService)], a3);
      }, 6193: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.RenderDebouncer = void 0, t4.RenderDebouncer = class {
          constructor(e5, t5) {
            this._renderCallback = e5, this._coreBrowserService = t5, this._refreshCallbacks = [];
          }
          dispose() {
            this._animationFrame && (this._coreBrowserService.window.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
          }
          addRefreshCallback(e5) {
            return this._refreshCallbacks.push(e5), this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh())), this._animationFrame;
          }
          refresh(e5, t5, i5) {
            this._rowCount = i5, e5 = void 0 !== e5 ? e5 : 0, t5 = void 0 !== t5 ? t5 : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e5) : e5, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t5) : t5, this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh()));
          }
          _innerRefresh() {
            if (this._animationFrame = void 0, void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount) return void this._runRefreshCallbacks();
            const e5 = Math.max(this._rowStart, 0), t5 = Math.min(this._rowEnd, this._rowCount - 1);
            this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e5, t5), this._runRefreshCallbacks();
          }
          _runRefreshCallbacks() {
            for (const e5 of this._refreshCallbacks) e5(0);
            this._refreshCallbacks = [];
          }
        };
      }, 3236: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.Terminal = void 0;
        const s4 = i5(3614), r3 = i5(3656), n2 = i5(3551), o3 = i5(9042), a3 = i5(3730), h3 = i5(1680), c3 = i5(3107), l3 = i5(5744), d3 = i5(2950), _2 = i5(1296), u4 = i5(428), f4 = i5(4269), v3 = i5(5114), p3 = i5(8934), g2 = i5(3230), m3 = i5(9312), S2 = i5(4725), C3 = i5(6731), b2 = i5(8055), w3 = i5(8969), y3 = i5(8460), E2 = i5(844), k3 = i5(6114), L2 = i5(8437), D3 = i5(2584), R2 = i5(7399), x2 = i5(5941), A3 = i5(9074), B3 = i5(2585), T3 = i5(5435), M = i5(4567), O2 = i5(779);
        class P2 extends w3.CoreTerminal {
          get onFocus() {
            return this._onFocus.event;
          }
          get onBlur() {
            return this._onBlur.event;
          }
          get onA11yChar() {
            return this._onA11yCharEmitter.event;
          }
          get onA11yTab() {
            return this._onA11yTabEmitter.event;
          }
          get onWillOpen() {
            return this._onWillOpen.event;
          }
          constructor(e5 = {}) {
            super(e5), this.browser = k3, this._keyDownHandled = false, this._keyDownSeen = false, this._keyPressHandled = false, this._unprocessedDeadKey = false, this._accessibilityManager = this.register(new E2.MutableDisposable()), this._onCursorMove = this.register(new y3.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onKey = this.register(new y3.EventEmitter()), this.onKey = this._onKey.event, this._onRender = this.register(new y3.EventEmitter()), this.onRender = this._onRender.event, this._onSelectionChange = this.register(new y3.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onTitleChange = this.register(new y3.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onBell = this.register(new y3.EventEmitter()), this.onBell = this._onBell.event, this._onFocus = this.register(new y3.EventEmitter()), this._onBlur = this.register(new y3.EventEmitter()), this._onA11yCharEmitter = this.register(new y3.EventEmitter()), this._onA11yTabEmitter = this.register(new y3.EventEmitter()), this._onWillOpen = this.register(new y3.EventEmitter()), this._setup(), this._decorationService = this._instantiationService.createInstance(A3.DecorationService), this._instantiationService.setService(B3.IDecorationService, this._decorationService), this._linkProviderService = this._instantiationService.createInstance(O2.LinkProviderService), this._instantiationService.setService(S2.ILinkProviderService, this._linkProviderService), this._linkProviderService.registerLinkProvider(this._instantiationService.createInstance(a3.OscLinkProvider)), this.register(this._inputHandler.onRequestBell(() => this._onBell.fire())), this.register(this._inputHandler.onRequestRefreshRows((e6, t5) => this.refresh(e6, t5))), this.register(this._inputHandler.onRequestSendFocus(() => this._reportFocus())), this.register(this._inputHandler.onRequestReset(() => this.reset())), this.register(this._inputHandler.onRequestWindowsOptionsReport((e6) => this._reportWindowsOptions(e6))), this.register(this._inputHandler.onColor((e6) => this._handleColorEvent(e6))), this.register((0, y3.forwardEvent)(this._inputHandler.onCursorMove, this._onCursorMove)), this.register((0, y3.forwardEvent)(this._inputHandler.onTitleChange, this._onTitleChange)), this.register((0, y3.forwardEvent)(this._inputHandler.onA11yChar, this._onA11yCharEmitter)), this.register((0, y3.forwardEvent)(this._inputHandler.onA11yTab, this._onA11yTabEmitter)), this.register(this._bufferService.onResize((e6) => this._afterResize(e6.cols, e6.rows))), this.register((0, E2.toDisposable)(() => {
              this._customKeyEventHandler = void 0, this.element?.parentNode?.removeChild(this.element);
            }));
          }
          _handleColorEvent(e5) {
            if (this._themeService) for (const t5 of e5) {
              let e6, i6 = "";
              switch (t5.index) {
                case 256:
                  e6 = "foreground", i6 = "10";
                  break;
                case 257:
                  e6 = "background", i6 = "11";
                  break;
                case 258:
                  e6 = "cursor", i6 = "12";
                  break;
                default:
                  e6 = "ansi", i6 = "4;" + t5.index;
              }
              switch (t5.type) {
                case 0:
                  const s5 = b2.color.toColorRGB("ansi" === e6 ? this._themeService.colors.ansi[t5.index] : this._themeService.colors[e6]);
                  this.coreService.triggerDataEvent(`${D3.C0.ESC}]${i6};${(0, x2.toRgbString)(s5)}${D3.C1_ESCAPED.ST}`);
                  break;
                case 1:
                  if ("ansi" === e6) this._themeService.modifyColors((e7) => e7.ansi[t5.index] = b2.channels.toColor(...t5.color));
                  else {
                    const i7 = e6;
                    this._themeService.modifyColors((e7) => e7[i7] = b2.channels.toColor(...t5.color));
                  }
                  break;
                case 2:
                  this._themeService.restoreColor(t5.index);
              }
            }
          }
          _setup() {
            super._setup(), this._customKeyEventHandler = void 0;
          }
          get buffer() {
            return this.buffers.active;
          }
          focus() {
            this.textarea && this.textarea.focus({ preventScroll: true });
          }
          _handleScreenReaderModeOptionChange(e5) {
            e5 ? !this._accessibilityManager.value && this._renderService && (this._accessibilityManager.value = this._instantiationService.createInstance(M.AccessibilityManager, this)) : this._accessibilityManager.clear();
          }
          _handleTextAreaFocus(e5) {
            this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D3.C0.ESC + "[I"), this.element.classList.add("focus"), this._showCursor(), this._onFocus.fire();
          }
          blur() {
            return this.textarea?.blur();
          }
          _handleTextAreaBlur() {
            this.textarea.value = "", this.refresh(this.buffer.y, this.buffer.y), this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D3.C0.ESC + "[O"), this.element.classList.remove("focus"), this._onBlur.fire();
          }
          _syncTextArea() {
            if (!this.textarea || !this.buffer.isCursorInViewport || this._compositionHelper.isComposing || !this._renderService) return;
            const e5 = this.buffer.ybase + this.buffer.y, t5 = this.buffer.lines.get(e5);
            if (!t5) return;
            const i6 = Math.min(this.buffer.x, this.cols - 1), s5 = this._renderService.dimensions.css.cell.height, r4 = t5.getWidth(i6), n3 = this._renderService.dimensions.css.cell.width * r4, o4 = this.buffer.y * this._renderService.dimensions.css.cell.height, a4 = i6 * this._renderService.dimensions.css.cell.width;
            this.textarea.style.left = a4 + "px", this.textarea.style.top = o4 + "px", this.textarea.style.width = n3 + "px", this.textarea.style.height = s5 + "px", this.textarea.style.lineHeight = s5 + "px", this.textarea.style.zIndex = "-5";
          }
          _initGlobal() {
            this._bindKeys(), this.register((0, r3.addDisposableDomListener)(this.element, "copy", (e6) => {
              this.hasSelection() && (0, s4.copyHandler)(e6, this._selectionService);
            }));
            const e5 = (e6) => (0, s4.handlePasteEvent)(e6, this.textarea, this.coreService, this.optionsService);
            this.register((0, r3.addDisposableDomListener)(this.textarea, "paste", e5)), this.register((0, r3.addDisposableDomListener)(this.element, "paste", e5)), k3.isFirefox ? this.register((0, r3.addDisposableDomListener)(this.element, "mousedown", (e6) => {
              2 === e6.button && (0, s4.rightClickHandler)(e6, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
            })) : this.register((0, r3.addDisposableDomListener)(this.element, "contextmenu", (e6) => {
              (0, s4.rightClickHandler)(e6, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
            })), k3.isLinux && this.register((0, r3.addDisposableDomListener)(this.element, "auxclick", (e6) => {
              1 === e6.button && (0, s4.moveTextAreaUnderMouseCursor)(e6, this.textarea, this.screenElement);
            }));
          }
          _bindKeys() {
            this.register((0, r3.addDisposableDomListener)(this.textarea, "keyup", (e5) => this._keyUp(e5), true)), this.register((0, r3.addDisposableDomListener)(this.textarea, "keydown", (e5) => this._keyDown(e5), true)), this.register((0, r3.addDisposableDomListener)(this.textarea, "keypress", (e5) => this._keyPress(e5), true)), this.register((0, r3.addDisposableDomListener)(this.textarea, "compositionstart", () => this._compositionHelper.compositionstart())), this.register((0, r3.addDisposableDomListener)(this.textarea, "compositionupdate", (e5) => this._compositionHelper.compositionupdate(e5))), this.register((0, r3.addDisposableDomListener)(this.textarea, "compositionend", () => this._compositionHelper.compositionend())), this.register((0, r3.addDisposableDomListener)(this.textarea, "input", (e5) => this._inputEvent(e5), true)), this.register(this.onRender(() => this._compositionHelper.updateCompositionElements()));
          }
          open(e5) {
            if (!e5) throw new Error("Terminal requires a parent element.");
            if (e5.isConnected || this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"), this.element?.ownerDocument.defaultView && this._coreBrowserService) return void (this.element.ownerDocument.defaultView !== this._coreBrowserService.window && (this._coreBrowserService.window = this.element.ownerDocument.defaultView));
            this._document = e5.ownerDocument, this.options.documentOverride && this.options.documentOverride instanceof Document && (this._document = this.optionsService.rawOptions.documentOverride), this.element = this._document.createElement("div"), this.element.dir = "ltr", this.element.classList.add("terminal"), this.element.classList.add("xterm"), e5.appendChild(this.element);
            const t5 = this._document.createDocumentFragment();
            this._viewportElement = this._document.createElement("div"), this._viewportElement.classList.add("xterm-viewport"), t5.appendChild(this._viewportElement), this._viewportScrollArea = this._document.createElement("div"), this._viewportScrollArea.classList.add("xterm-scroll-area"), this._viewportElement.appendChild(this._viewportScrollArea), this.screenElement = this._document.createElement("div"), this.screenElement.classList.add("xterm-screen"), this.register((0, r3.addDisposableDomListener)(this.screenElement, "mousemove", (e6) => this.updateCursorStyle(e6))), this._helperContainer = this._document.createElement("div"), this._helperContainer.classList.add("xterm-helpers"), this.screenElement.appendChild(this._helperContainer), t5.appendChild(this.screenElement), this.textarea = this._document.createElement("textarea"), this.textarea.classList.add("xterm-helper-textarea"), this.textarea.setAttribute("aria-label", o3.promptLabel), k3.isChromeOS || this.textarea.setAttribute("aria-multiline", "false"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.tabIndex = 0, this._coreBrowserService = this.register(this._instantiationService.createInstance(v3.CoreBrowserService, this.textarea, e5.ownerDocument.defaultView ?? window, this._document ?? "undefined" != typeof window ? window.document : null)), this._instantiationService.setService(S2.ICoreBrowserService, this._coreBrowserService), this.register((0, r3.addDisposableDomListener)(this.textarea, "focus", (e6) => this._handleTextAreaFocus(e6))), this.register((0, r3.addDisposableDomListener)(this.textarea, "blur", () => this._handleTextAreaBlur())), this._helperContainer.appendChild(this.textarea), this._charSizeService = this._instantiationService.createInstance(u4.CharSizeService, this._document, this._helperContainer), this._instantiationService.setService(S2.ICharSizeService, this._charSizeService), this._themeService = this._instantiationService.createInstance(C3.ThemeService), this._instantiationService.setService(S2.IThemeService, this._themeService), this._characterJoinerService = this._instantiationService.createInstance(f4.CharacterJoinerService), this._instantiationService.setService(S2.ICharacterJoinerService, this._characterJoinerService), this._renderService = this.register(this._instantiationService.createInstance(g2.RenderService, this.rows, this.screenElement)), this._instantiationService.setService(S2.IRenderService, this._renderService), this.register(this._renderService.onRenderedViewportChange((e6) => this._onRender.fire(e6))), this.onResize((e6) => this._renderService.resize(e6.cols, e6.rows)), this._compositionView = this._document.createElement("div"), this._compositionView.classList.add("composition-view"), this._compositionHelper = this._instantiationService.createInstance(d3.CompositionHelper, this.textarea, this._compositionView), this._helperContainer.appendChild(this._compositionView), this._mouseService = this._instantiationService.createInstance(p3.MouseService), this._instantiationService.setService(S2.IMouseService, this._mouseService), this.linkifier = this.register(this._instantiationService.createInstance(n2.Linkifier, this.screenElement)), this.element.appendChild(t5);
            try {
              this._onWillOpen.fire(this.element);
            } catch {
            }
            this._renderService.hasRenderer() || this._renderService.setRenderer(this._createRenderer()), this.viewport = this._instantiationService.createInstance(h3.Viewport, this._viewportElement, this._viewportScrollArea), this.viewport.onRequestScrollLines((e6) => this.scrollLines(e6.amount, e6.suppressScrollEvent, 1)), this.register(this._inputHandler.onRequestSyncScrollBar(() => this.viewport.syncScrollArea())), this.register(this.viewport), this.register(this.onCursorMove(() => {
              this._renderService.handleCursorMove(), this._syncTextArea();
            })), this.register(this.onResize(() => this._renderService.handleResize(this.cols, this.rows))), this.register(this.onBlur(() => this._renderService.handleBlur())), this.register(this.onFocus(() => this._renderService.handleFocus())), this.register(this._renderService.onDimensionsChange(() => this.viewport.syncScrollArea())), this._selectionService = this.register(this._instantiationService.createInstance(m3.SelectionService, this.element, this.screenElement, this.linkifier)), this._instantiationService.setService(S2.ISelectionService, this._selectionService), this.register(this._selectionService.onRequestScrollLines((e6) => this.scrollLines(e6.amount, e6.suppressScrollEvent))), this.register(this._selectionService.onSelectionChange(() => this._onSelectionChange.fire())), this.register(this._selectionService.onRequestRedraw((e6) => this._renderService.handleSelectionChanged(e6.start, e6.end, e6.columnSelectMode))), this.register(this._selectionService.onLinuxMouseSelection((e6) => {
              this.textarea.value = e6, this.textarea.focus(), this.textarea.select();
            })), this.register(this._onScroll.event((e6) => {
              this.viewport.syncScrollArea(), this._selectionService.refresh();
            })), this.register((0, r3.addDisposableDomListener)(this._viewportElement, "scroll", () => this._selectionService.refresh())), this.register(this._instantiationService.createInstance(c3.BufferDecorationRenderer, this.screenElement)), this.register((0, r3.addDisposableDomListener)(this.element, "mousedown", (e6) => this._selectionService.handleMouseDown(e6))), this.coreMouseService.areMouseEventsActive ? (this._selectionService.disable(), this.element.classList.add("enable-mouse-events")) : this._selectionService.enable(), this.options.screenReaderMode && (this._accessibilityManager.value = this._instantiationService.createInstance(M.AccessibilityManager, this)), this.register(this.optionsService.onSpecificOptionChange("screenReaderMode", (e6) => this._handleScreenReaderModeOptionChange(e6))), this.options.overviewRulerWidth && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l3.OverviewRulerRenderer, this._viewportElement, this.screenElement))), this.optionsService.onSpecificOptionChange("overviewRulerWidth", (e6) => {
              !this._overviewRulerRenderer && e6 && this._viewportElement && this.screenElement && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l3.OverviewRulerRenderer, this._viewportElement, this.screenElement)));
            }), this._charSizeService.measure(), this.refresh(0, this.rows - 1), this._initGlobal(), this.bindMouse();
          }
          _createRenderer() {
            return this._instantiationService.createInstance(_2.DomRenderer, this, this._document, this.element, this.screenElement, this._viewportElement, this._helperContainer, this.linkifier);
          }
          bindMouse() {
            const e5 = this, t5 = this.element;
            function i6(t6) {
              const i7 = e5._mouseService.getMouseReportCoords(t6, e5.screenElement);
              if (!i7) return false;
              let s6, r4;
              switch (t6.overrideType || t6.type) {
                case "mousemove":
                  r4 = 32, void 0 === t6.buttons ? (s6 = 3, void 0 !== t6.button && (s6 = t6.button < 3 ? t6.button : 3)) : s6 = 1 & t6.buttons ? 0 : 4 & t6.buttons ? 1 : 2 & t6.buttons ? 2 : 3;
                  break;
                case "mouseup":
                  r4 = 0, s6 = t6.button < 3 ? t6.button : 3;
                  break;
                case "mousedown":
                  r4 = 1, s6 = t6.button < 3 ? t6.button : 3;
                  break;
                case "wheel":
                  if (e5._customWheelEventHandler && false === e5._customWheelEventHandler(t6)) return false;
                  if (0 === e5.viewport.getLinesScrolled(t6)) return false;
                  r4 = t6.deltaY < 0 ? 0 : 1, s6 = 4;
                  break;
                default:
                  return false;
              }
              return !(void 0 === r4 || void 0 === s6 || s6 > 4) && e5.coreMouseService.triggerMouseEvent({ col: i7.col, row: i7.row, x: i7.x, y: i7.y, button: s6, action: r4, ctrl: t6.ctrlKey, alt: t6.altKey, shift: t6.shiftKey });
            }
            const s5 = { mouseup: null, wheel: null, mousedrag: null, mousemove: null }, n3 = { mouseup: (e6) => (i6(e6), e6.buttons || (this._document.removeEventListener("mouseup", s5.mouseup), s5.mousedrag && this._document.removeEventListener("mousemove", s5.mousedrag)), this.cancel(e6)), wheel: (e6) => (i6(e6), this.cancel(e6, true)), mousedrag: (e6) => {
              e6.buttons && i6(e6);
            }, mousemove: (e6) => {
              e6.buttons || i6(e6);
            } };
            this.register(this.coreMouseService.onProtocolChange((e6) => {
              e6 ? ("debug" === this.optionsService.rawOptions.logLevel && this._logService.debug("Binding to mouse events:", this.coreMouseService.explainEvents(e6)), this.element.classList.add("enable-mouse-events"), this._selectionService.disable()) : (this._logService.debug("Unbinding from mouse events."), this.element.classList.remove("enable-mouse-events"), this._selectionService.enable()), 8 & e6 ? s5.mousemove || (t5.addEventListener("mousemove", n3.mousemove), s5.mousemove = n3.mousemove) : (t5.removeEventListener("mousemove", s5.mousemove), s5.mousemove = null), 16 & e6 ? s5.wheel || (t5.addEventListener("wheel", n3.wheel, { passive: false }), s5.wheel = n3.wheel) : (t5.removeEventListener("wheel", s5.wheel), s5.wheel = null), 2 & e6 ? s5.mouseup || (s5.mouseup = n3.mouseup) : (this._document.removeEventListener("mouseup", s5.mouseup), s5.mouseup = null), 4 & e6 ? s5.mousedrag || (s5.mousedrag = n3.mousedrag) : (this._document.removeEventListener("mousemove", s5.mousedrag), s5.mousedrag = null);
            })), this.coreMouseService.activeProtocol = this.coreMouseService.activeProtocol, this.register((0, r3.addDisposableDomListener)(t5, "mousedown", (e6) => {
              if (e6.preventDefault(), this.focus(), this.coreMouseService.areMouseEventsActive && !this._selectionService.shouldForceSelection(e6)) return i6(e6), s5.mouseup && this._document.addEventListener("mouseup", s5.mouseup), s5.mousedrag && this._document.addEventListener("mousemove", s5.mousedrag), this.cancel(e6);
            })), this.register((0, r3.addDisposableDomListener)(t5, "wheel", (e6) => {
              if (!s5.wheel) {
                if (this._customWheelEventHandler && false === this._customWheelEventHandler(e6)) return false;
                if (!this.buffer.hasScrollback) {
                  const t6 = this.viewport.getLinesScrolled(e6);
                  if (0 === t6) return;
                  const i7 = D3.C0.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (e6.deltaY < 0 ? "A" : "B");
                  let s6 = "";
                  for (let e7 = 0; e7 < Math.abs(t6); e7++) s6 += i7;
                  return this.coreService.triggerDataEvent(s6, true), this.cancel(e6, true);
                }
                return this.viewport.handleWheel(e6) ? this.cancel(e6) : void 0;
              }
            }, { passive: false })), this.register((0, r3.addDisposableDomListener)(t5, "touchstart", (e6) => {
              if (!this.coreMouseService.areMouseEventsActive) return this.viewport.handleTouchStart(e6), this.cancel(e6);
            }, { passive: true })), this.register((0, r3.addDisposableDomListener)(t5, "touchmove", (e6) => {
              if (!this.coreMouseService.areMouseEventsActive) return this.viewport.handleTouchMove(e6) ? void 0 : this.cancel(e6);
            }, { passive: false }));
          }
          refresh(e5, t5) {
            this._renderService?.refreshRows(e5, t5);
          }
          updateCursorStyle(e5) {
            this._selectionService?.shouldColumnSelect(e5) ? this.element.classList.add("column-select") : this.element.classList.remove("column-select");
          }
          _showCursor() {
            this.coreService.isCursorInitialized || (this.coreService.isCursorInitialized = true, this.refresh(this.buffer.y, this.buffer.y));
          }
          scrollLines(e5, t5, i6 = 0) {
            1 === i6 ? (super.scrollLines(e5, t5, i6), this.refresh(0, this.rows - 1)) : this.viewport?.scrollLines(e5);
          }
          paste(e5) {
            (0, s4.paste)(e5, this.textarea, this.coreService, this.optionsService);
          }
          attachCustomKeyEventHandler(e5) {
            this._customKeyEventHandler = e5;
          }
          attachCustomWheelEventHandler(e5) {
            this._customWheelEventHandler = e5;
          }
          registerLinkProvider(e5) {
            return this._linkProviderService.registerLinkProvider(e5);
          }
          registerCharacterJoiner(e5) {
            if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
            const t5 = this._characterJoinerService.register(e5);
            return this.refresh(0, this.rows - 1), t5;
          }
          deregisterCharacterJoiner(e5) {
            if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
            this._characterJoinerService.deregister(e5) && this.refresh(0, this.rows - 1);
          }
          get markers() {
            return this.buffer.markers;
          }
          registerMarker(e5) {
            return this.buffer.addMarker(this.buffer.ybase + this.buffer.y + e5);
          }
          registerDecoration(e5) {
            return this._decorationService.registerDecoration(e5);
          }
          hasSelection() {
            return !!this._selectionService && this._selectionService.hasSelection;
          }
          select(e5, t5, i6) {
            this._selectionService.setSelection(e5, t5, i6);
          }
          getSelection() {
            return this._selectionService ? this._selectionService.selectionText : "";
          }
          getSelectionPosition() {
            if (this._selectionService && this._selectionService.hasSelection) return { start: { x: this._selectionService.selectionStart[0], y: this._selectionService.selectionStart[1] }, end: { x: this._selectionService.selectionEnd[0], y: this._selectionService.selectionEnd[1] } };
          }
          clearSelection() {
            this._selectionService?.clearSelection();
          }
          selectAll() {
            this._selectionService?.selectAll();
          }
          selectLines(e5, t5) {
            this._selectionService?.selectLines(e5, t5);
          }
          _keyDown(e5) {
            if (this._keyDownHandled = false, this._keyDownSeen = true, this._customKeyEventHandler && false === this._customKeyEventHandler(e5)) return false;
            const t5 = this.browser.isMac && this.options.macOptionIsMeta && e5.altKey;
            if (!t5 && !this._compositionHelper.keydown(e5)) return this.options.scrollOnUserInput && this.buffer.ybase !== this.buffer.ydisp && this.scrollToBottom(), false;
            t5 || "Dead" !== e5.key && "AltGraph" !== e5.key || (this._unprocessedDeadKey = true);
            const i6 = (0, R2.evaluateKeyboardEvent)(e5, this.coreService.decPrivateModes.applicationCursorKeys, this.browser.isMac, this.options.macOptionIsMeta);
            if (this.updateCursorStyle(e5), 3 === i6.type || 2 === i6.type) {
              const t6 = this.rows - 1;
              return this.scrollLines(2 === i6.type ? -t6 : t6), this.cancel(e5, true);
            }
            return 1 === i6.type && this.selectAll(), !!this._isThirdLevelShift(this.browser, e5) || (i6.cancel && this.cancel(e5, true), !i6.key || !!(e5.key && !e5.ctrlKey && !e5.altKey && !e5.metaKey && 1 === e5.key.length && e5.key.charCodeAt(0) >= 65 && e5.key.charCodeAt(0) <= 90) || (this._unprocessedDeadKey ? (this._unprocessedDeadKey = false, true) : (i6.key !== D3.C0.ETX && i6.key !== D3.C0.CR || (this.textarea.value = ""), this._onKey.fire({ key: i6.key, domEvent: e5 }), this._showCursor(), this.coreService.triggerDataEvent(i6.key, true), !this.optionsService.rawOptions.screenReaderMode || e5.altKey || e5.ctrlKey ? this.cancel(e5, true) : void (this._keyDownHandled = true))));
          }
          _isThirdLevelShift(e5, t5) {
            const i6 = e5.isMac && !this.options.macOptionIsMeta && t5.altKey && !t5.ctrlKey && !t5.metaKey || e5.isWindows && t5.altKey && t5.ctrlKey && !t5.metaKey || e5.isWindows && t5.getModifierState("AltGraph");
            return "keypress" === t5.type ? i6 : i6 && (!t5.keyCode || t5.keyCode > 47);
          }
          _keyUp(e5) {
            this._keyDownSeen = false, this._customKeyEventHandler && false === this._customKeyEventHandler(e5) || (function(e6) {
              return 16 === e6.keyCode || 17 === e6.keyCode || 18 === e6.keyCode;
            }(e5) || this.focus(), this.updateCursorStyle(e5), this._keyPressHandled = false);
          }
          _keyPress(e5) {
            let t5;
            if (this._keyPressHandled = false, this._keyDownHandled) return false;
            if (this._customKeyEventHandler && false === this._customKeyEventHandler(e5)) return false;
            if (this.cancel(e5), e5.charCode) t5 = e5.charCode;
            else if (null === e5.which || void 0 === e5.which) t5 = e5.keyCode;
            else {
              if (0 === e5.which || 0 === e5.charCode) return false;
              t5 = e5.which;
            }
            return !(!t5 || (e5.altKey || e5.ctrlKey || e5.metaKey) && !this._isThirdLevelShift(this.browser, e5) || (t5 = String.fromCharCode(t5), this._onKey.fire({ key: t5, domEvent: e5 }), this._showCursor(), this.coreService.triggerDataEvent(t5, true), this._keyPressHandled = true, this._unprocessedDeadKey = false, 0));
          }
          _inputEvent(e5) {
            if (e5.data && "insertText" === e5.inputType && (!e5.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {
              if (this._keyPressHandled) return false;
              this._unprocessedDeadKey = false;
              const t5 = e5.data;
              return this.coreService.triggerDataEvent(t5, true), this.cancel(e5), true;
            }
            return false;
          }
          resize(e5, t5) {
            e5 !== this.cols || t5 !== this.rows ? super.resize(e5, t5) : this._charSizeService && !this._charSizeService.hasValidSize && this._charSizeService.measure();
          }
          _afterResize(e5, t5) {
            this._charSizeService?.measure(), this.viewport?.syncScrollArea(true);
          }
          clear() {
            if (0 !== this.buffer.ybase || 0 !== this.buffer.y) {
              this.buffer.clearAllMarkers(), this.buffer.lines.set(0, this.buffer.lines.get(this.buffer.ybase + this.buffer.y)), this.buffer.lines.length = 1, this.buffer.ydisp = 0, this.buffer.ybase = 0, this.buffer.y = 0;
              for (let e5 = 1; e5 < this.rows; e5++) this.buffer.lines.push(this.buffer.getBlankLine(L2.DEFAULT_ATTR_DATA));
              this._onScroll.fire({ position: this.buffer.ydisp, source: 0 }), this.viewport?.reset(), this.refresh(0, this.rows - 1);
            }
          }
          reset() {
            this.options.rows = this.rows, this.options.cols = this.cols;
            const e5 = this._customKeyEventHandler;
            this._setup(), super.reset(), this._selectionService?.reset(), this._decorationService.reset(), this.viewport?.reset(), this._customKeyEventHandler = e5, this.refresh(0, this.rows - 1);
          }
          clearTextureAtlas() {
            this._renderService?.clearTextureAtlas();
          }
          _reportFocus() {
            this.element?.classList.contains("focus") ? this.coreService.triggerDataEvent(D3.C0.ESC + "[I") : this.coreService.triggerDataEvent(D3.C0.ESC + "[O");
          }
          _reportWindowsOptions(e5) {
            if (this._renderService) switch (e5) {
              case T3.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:
                const e6 = this._renderService.dimensions.css.canvas.width.toFixed(0), t5 = this._renderService.dimensions.css.canvas.height.toFixed(0);
                this.coreService.triggerDataEvent(`${D3.C0.ESC}[4;${t5};${e6}t`);
                break;
              case T3.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:
                const i6 = this._renderService.dimensions.css.cell.width.toFixed(0), s5 = this._renderService.dimensions.css.cell.height.toFixed(0);
                this.coreService.triggerDataEvent(`${D3.C0.ESC}[6;${s5};${i6}t`);
            }
          }
          cancel(e5, t5) {
            if (this.options.cancelEvents || t5) return e5.preventDefault(), e5.stopPropagation(), false;
          }
        }
        t4.Terminal = P2;
      }, 9924: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.TimeBasedDebouncer = void 0, t4.TimeBasedDebouncer = class {
          constructor(e5, t5 = 1e3) {
            this._renderCallback = e5, this._debounceThresholdMS = t5, this._lastRefreshMs = 0, this._additionalRefreshRequested = false;
          }
          dispose() {
            this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
          }
          refresh(e5, t5, i5) {
            this._rowCount = i5, e5 = void 0 !== e5 ? e5 : 0, t5 = void 0 !== t5 ? t5 : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e5) : e5, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t5) : t5;
            const s4 = Date.now();
            if (s4 - this._lastRefreshMs >= this._debounceThresholdMS) this._lastRefreshMs = s4, this._innerRefresh();
            else if (!this._additionalRefreshRequested) {
              const e6 = s4 - this._lastRefreshMs, t6 = this._debounceThresholdMS - e6;
              this._additionalRefreshRequested = true, this._refreshTimeoutID = window.setTimeout(() => {
                this._lastRefreshMs = Date.now(), this._innerRefresh(), this._additionalRefreshRequested = false, this._refreshTimeoutID = void 0;
              }, t6);
            }
          }
          _innerRefresh() {
            if (void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount) return;
            const e5 = Math.max(this._rowStart, 0), t5 = Math.min(this._rowEnd, this._rowCount - 1);
            this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e5, t5);
          }
        };
      }, 1680: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.Viewport = void 0;
        const n2 = i5(3656), o3 = i5(4725), a3 = i5(8460), h3 = i5(844), c3 = i5(2585);
        let l3 = t4.Viewport = class extends h3.Disposable {
          constructor(e5, t5, i6, s5, r4, o4, h4, c4) {
            super(), this._viewportElement = e5, this._scrollArea = t5, this._bufferService = i6, this._optionsService = s5, this._charSizeService = r4, this._renderService = o4, this._coreBrowserService = h4, this.scrollBarWidth = 0, this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._wheelPartialScroll = 0, this._refreshAnimationFrame = null, this._ignoreNextScrollEvent = false, this._smoothScrollState = { startTime: 0, origin: -1, target: -1 }, this._onRequestScrollLines = this.register(new a3.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this.scrollBarWidth = this._viewportElement.offsetWidth - this._scrollArea.offsetWidth || 15, this.register((0, n2.addDisposableDomListener)(this._viewportElement, "scroll", this._handleScroll.bind(this))), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate((e6) => this._activeBuffer = e6.activeBuffer)), this._renderDimensions = this._renderService.dimensions, this.register(this._renderService.onDimensionsChange((e6) => this._renderDimensions = e6)), this._handleThemeChange(c4.colors), this.register(c4.onChangeColors((e6) => this._handleThemeChange(e6))), this.register(this._optionsService.onSpecificOptionChange("scrollback", () => this.syncScrollArea())), setTimeout(() => this.syncScrollArea());
          }
          _handleThemeChange(e5) {
            this._viewportElement.style.backgroundColor = e5.background.css;
          }
          reset() {
            this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._coreBrowserService.window.requestAnimationFrame(() => this.syncScrollArea());
          }
          _refresh(e5) {
            if (e5) return this._innerRefresh(), void (null !== this._refreshAnimationFrame && this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));
            null === this._refreshAnimationFrame && (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh()));
          }
          _innerRefresh() {
            if (this._charSizeService.height > 0) {
              this._currentRowHeight = this._renderDimensions.device.cell.height / this._coreBrowserService.dpr, this._currentDeviceCellHeight = this._renderDimensions.device.cell.height, this._lastRecordedViewportHeight = this._viewportElement.offsetHeight;
              const e6 = Math.round(this._currentRowHeight * this._lastRecordedBufferLength) + (this._lastRecordedViewportHeight - this._renderDimensions.css.canvas.height);
              this._lastRecordedBufferHeight !== e6 && (this._lastRecordedBufferHeight = e6, this._scrollArea.style.height = this._lastRecordedBufferHeight + "px");
            }
            const e5 = this._bufferService.buffer.ydisp * this._currentRowHeight;
            this._viewportElement.scrollTop !== e5 && (this._ignoreNextScrollEvent = true, this._viewportElement.scrollTop = e5), this._refreshAnimationFrame = null;
          }
          syncScrollArea(e5 = false) {
            if (this._lastRecordedBufferLength !== this._bufferService.buffer.lines.length) return this._lastRecordedBufferLength = this._bufferService.buffer.lines.length, void this._refresh(e5);
            this._lastRecordedViewportHeight === this._renderService.dimensions.css.canvas.height && this._lastScrollTop === this._activeBuffer.ydisp * this._currentRowHeight && this._renderDimensions.device.cell.height === this._currentDeviceCellHeight || this._refresh(e5);
          }
          _handleScroll(e5) {
            if (this._lastScrollTop = this._viewportElement.scrollTop, !this._viewportElement.offsetParent) return;
            if (this._ignoreNextScrollEvent) return this._ignoreNextScrollEvent = false, void this._onRequestScrollLines.fire({ amount: 0, suppressScrollEvent: true });
            const t5 = Math.round(this._lastScrollTop / this._currentRowHeight) - this._bufferService.buffer.ydisp;
            this._onRequestScrollLines.fire({ amount: t5, suppressScrollEvent: true });
          }
          _smoothScroll() {
            if (this._isDisposed || -1 === this._smoothScrollState.origin || -1 === this._smoothScrollState.target) return;
            const e5 = this._smoothScrollPercent();
            this._viewportElement.scrollTop = this._smoothScrollState.origin + Math.round(e5 * (this._smoothScrollState.target - this._smoothScrollState.origin)), e5 < 1 ? this._coreBrowserService.window.requestAnimationFrame(() => this._smoothScroll()) : this._clearSmoothScrollState();
          }
          _smoothScrollPercent() {
            return this._optionsService.rawOptions.smoothScrollDuration && this._smoothScrollState.startTime ? Math.max(Math.min((Date.now() - this._smoothScrollState.startTime) / this._optionsService.rawOptions.smoothScrollDuration, 1), 0) : 1;
          }
          _clearSmoothScrollState() {
            this._smoothScrollState.startTime = 0, this._smoothScrollState.origin = -1, this._smoothScrollState.target = -1;
          }
          _bubbleScroll(e5, t5) {
            const i6 = this._viewportElement.scrollTop + this._lastRecordedViewportHeight;
            return !(t5 < 0 && 0 !== this._viewportElement.scrollTop || t5 > 0 && i6 < this._lastRecordedBufferHeight) || (e5.cancelable && e5.preventDefault(), false);
          }
          handleWheel(e5) {
            const t5 = this._getPixelsScrolled(e5);
            return 0 !== t5 && (this._optionsService.rawOptions.smoothScrollDuration ? (this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, -1 === this._smoothScrollState.target ? this._smoothScrollState.target = this._viewportElement.scrollTop + t5 : this._smoothScrollState.target += t5, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState()) : this._viewportElement.scrollTop += t5, this._bubbleScroll(e5, t5));
          }
          scrollLines(e5) {
            if (0 !== e5) if (this._optionsService.rawOptions.smoothScrollDuration) {
              const t5 = e5 * this._currentRowHeight;
              this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, this._smoothScrollState.target = this._smoothScrollState.origin + t5, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState();
            } else this._onRequestScrollLines.fire({ amount: e5, suppressScrollEvent: false });
          }
          _getPixelsScrolled(e5) {
            if (0 === e5.deltaY || e5.shiftKey) return 0;
            let t5 = this._applyScrollModifier(e5.deltaY, e5);
            return e5.deltaMode === WheelEvent.DOM_DELTA_LINE ? t5 *= this._currentRowHeight : e5.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t5 *= this._currentRowHeight * this._bufferService.rows), t5;
          }
          getBufferElements(e5, t5) {
            let i6, s5 = "";
            const r4 = [], n3 = t5 ?? this._bufferService.buffer.lines.length, o4 = this._bufferService.buffer.lines;
            for (let t6 = e5; t6 < n3; t6++) {
              const e6 = o4.get(t6);
              if (!e6) continue;
              const n4 = o4.get(t6 + 1)?.isWrapped;
              if (s5 += e6.translateToString(!n4), !n4 || t6 === o4.length - 1) {
                const e7 = document.createElement("div");
                e7.textContent = s5, r4.push(e7), s5.length > 0 && (i6 = e7), s5 = "";
              }
            }
            return { bufferElements: r4, cursorElement: i6 };
          }
          getLinesScrolled(e5) {
            if (0 === e5.deltaY || e5.shiftKey) return 0;
            let t5 = this._applyScrollModifier(e5.deltaY, e5);
            return e5.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? (t5 /= this._currentRowHeight + 0, this._wheelPartialScroll += t5, t5 = Math.floor(Math.abs(this._wheelPartialScroll)) * (this._wheelPartialScroll > 0 ? 1 : -1), this._wheelPartialScroll %= 1) : e5.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t5 *= this._bufferService.rows), t5;
          }
          _applyScrollModifier(e5, t5) {
            const i6 = this._optionsService.rawOptions.fastScrollModifier;
            return "alt" === i6 && t5.altKey || "ctrl" === i6 && t5.ctrlKey || "shift" === i6 && t5.shiftKey ? e5 * this._optionsService.rawOptions.fastScrollSensitivity * this._optionsService.rawOptions.scrollSensitivity : e5 * this._optionsService.rawOptions.scrollSensitivity;
          }
          handleTouchStart(e5) {
            this._lastTouchY = e5.touches[0].pageY;
          }
          handleTouchMove(e5) {
            const t5 = this._lastTouchY - e5.touches[0].pageY;
            return this._lastTouchY = e5.touches[0].pageY, 0 !== t5 && (this._viewportElement.scrollTop += t5, this._bubbleScroll(e5, t5));
          }
        };
        t4.Viewport = l3 = s4([r3(2, c3.IBufferService), r3(3, c3.IOptionsService), r3(4, o3.ICharSizeService), r3(5, o3.IRenderService), r3(6, o3.ICoreBrowserService), r3(7, o3.IThemeService)], l3);
      }, 3107: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.BufferDecorationRenderer = void 0;
        const n2 = i5(4725), o3 = i5(844), a3 = i5(2585);
        let h3 = t4.BufferDecorationRenderer = class extends o3.Disposable {
          constructor(e5, t5, i6, s5, r4) {
            super(), this._screenElement = e5, this._bufferService = t5, this._coreBrowserService = i6, this._decorationService = s5, this._renderService = r4, this._decorationElements = /* @__PURE__ */ new Map(), this._altBufferIsActive = false, this._dimensionsChanged = false, this._container = document.createElement("div"), this._container.classList.add("xterm-decoration-container"), this._screenElement.appendChild(this._container), this.register(this._renderService.onRenderedViewportChange(() => this._doRefreshDecorations())), this.register(this._renderService.onDimensionsChange(() => {
              this._dimensionsChanged = true, this._queueRefresh();
            })), this.register(this._coreBrowserService.onDprChange(() => this._queueRefresh())), this.register(this._bufferService.buffers.onBufferActivate(() => {
              this._altBufferIsActive = this._bufferService.buffer === this._bufferService.buffers.alt;
            })), this.register(this._decorationService.onDecorationRegistered(() => this._queueRefresh())), this.register(this._decorationService.onDecorationRemoved((e6) => this._removeDecoration(e6))), this.register((0, o3.toDisposable)(() => {
              this._container.remove(), this._decorationElements.clear();
            }));
          }
          _queueRefresh() {
            void 0 === this._animationFrame && (this._animationFrame = this._renderService.addRefreshCallback(() => {
              this._doRefreshDecorations(), this._animationFrame = void 0;
            }));
          }
          _doRefreshDecorations() {
            for (const e5 of this._decorationService.decorations) this._renderDecoration(e5);
            this._dimensionsChanged = false;
          }
          _renderDecoration(e5) {
            this._refreshStyle(e5), this._dimensionsChanged && this._refreshXPosition(e5);
          }
          _createElement(e5) {
            const t5 = this._coreBrowserService.mainDocument.createElement("div");
            t5.classList.add("xterm-decoration"), t5.classList.toggle("xterm-decoration-top-layer", "top" === e5?.options?.layer), t5.style.width = `${Math.round((e5.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, t5.style.height = (e5.options.height || 1) * this._renderService.dimensions.css.cell.height + "px", t5.style.top = (e5.marker.line - this._bufferService.buffers.active.ydisp) * this._renderService.dimensions.css.cell.height + "px", t5.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`;
            const i6 = e5.options.x ?? 0;
            return i6 && i6 > this._bufferService.cols && (t5.style.display = "none"), this._refreshXPosition(e5, t5), t5;
          }
          _refreshStyle(e5) {
            const t5 = e5.marker.line - this._bufferService.buffers.active.ydisp;
            if (t5 < 0 || t5 >= this._bufferService.rows) e5.element && (e5.element.style.display = "none", e5.onRenderEmitter.fire(e5.element));
            else {
              let i6 = this._decorationElements.get(e5);
              i6 || (i6 = this._createElement(e5), e5.element = i6, this._decorationElements.set(e5, i6), this._container.appendChild(i6), e5.onDispose(() => {
                this._decorationElements.delete(e5), i6.remove();
              })), i6.style.top = t5 * this._renderService.dimensions.css.cell.height + "px", i6.style.display = this._altBufferIsActive ? "none" : "block", e5.onRenderEmitter.fire(i6);
            }
          }
          _refreshXPosition(e5, t5 = e5.element) {
            if (!t5) return;
            const i6 = e5.options.x ?? 0;
            "right" === (e5.options.anchor || "left") ? t5.style.right = i6 ? i6 * this._renderService.dimensions.css.cell.width + "px" : "" : t5.style.left = i6 ? i6 * this._renderService.dimensions.css.cell.width + "px" : "";
          }
          _removeDecoration(e5) {
            this._decorationElements.get(e5)?.remove(), this._decorationElements.delete(e5), e5.dispose();
          }
        };
        t4.BufferDecorationRenderer = h3 = s4([r3(1, a3.IBufferService), r3(2, n2.ICoreBrowserService), r3(3, a3.IDecorationService), r3(4, n2.IRenderService)], h3);
      }, 5871: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.ColorZoneStore = void 0, t4.ColorZoneStore = class {
          constructor() {
            this._zones = [], this._zonePool = [], this._zonePoolIndex = 0, this._linePadding = { full: 0, left: 0, center: 0, right: 0 };
          }
          get zones() {
            return this._zonePool.length = Math.min(this._zonePool.length, this._zones.length), this._zones;
          }
          clear() {
            this._zones.length = 0, this._zonePoolIndex = 0;
          }
          addDecoration(e5) {
            if (e5.options.overviewRulerOptions) {
              for (const t5 of this._zones) if (t5.color === e5.options.overviewRulerOptions.color && t5.position === e5.options.overviewRulerOptions.position) {
                if (this._lineIntersectsZone(t5, e5.marker.line)) return;
                if (this._lineAdjacentToZone(t5, e5.marker.line, e5.options.overviewRulerOptions.position)) return void this._addLineToZone(t5, e5.marker.line);
              }
              if (this._zonePoolIndex < this._zonePool.length) return this._zonePool[this._zonePoolIndex].color = e5.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = e5.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = e5.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = e5.marker.line, void this._zones.push(this._zonePool[this._zonePoolIndex++]);
              this._zones.push({ color: e5.options.overviewRulerOptions.color, position: e5.options.overviewRulerOptions.position, startBufferLine: e5.marker.line, endBufferLine: e5.marker.line }), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
            }
          }
          setPadding(e5) {
            this._linePadding = e5;
          }
          _lineIntersectsZone(e5, t5) {
            return t5 >= e5.startBufferLine && t5 <= e5.endBufferLine;
          }
          _lineAdjacentToZone(e5, t5, i5) {
            return t5 >= e5.startBufferLine - this._linePadding[i5 || "full"] && t5 <= e5.endBufferLine + this._linePadding[i5 || "full"];
          }
          _addLineToZone(e5, t5) {
            e5.startBufferLine = Math.min(e5.startBufferLine, t5), e5.endBufferLine = Math.max(e5.endBufferLine, t5);
          }
        };
      }, 5744: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.OverviewRulerRenderer = void 0;
        const n2 = i5(5871), o3 = i5(4725), a3 = i5(844), h3 = i5(2585), c3 = { full: 0, left: 0, center: 0, right: 0 }, l3 = { full: 0, left: 0, center: 0, right: 0 }, d3 = { full: 0, left: 0, center: 0, right: 0 };
        let _2 = t4.OverviewRulerRenderer = class extends a3.Disposable {
          get _width() {
            return this._optionsService.options.overviewRulerWidth || 0;
          }
          constructor(e5, t5, i6, s5, r4, o4, h4) {
            super(), this._viewportElement = e5, this._screenElement = t5, this._bufferService = i6, this._decorationService = s5, this._renderService = r4, this._optionsService = o4, this._coreBrowserService = h4, this._colorZoneStore = new n2.ColorZoneStore(), this._shouldUpdateDimensions = true, this._shouldUpdateAnchor = true, this._lastKnownBufferLength = 0, this._canvas = this._coreBrowserService.mainDocument.createElement("canvas"), this._canvas.classList.add("xterm-decoration-overview-ruler"), this._refreshCanvasDimensions(), this._viewportElement.parentElement?.insertBefore(this._canvas, this._viewportElement);
            const c4 = this._canvas.getContext("2d");
            if (!c4) throw new Error("Ctx cannot be null");
            this._ctx = c4, this._registerDecorationListeners(), this._registerBufferChangeListeners(), this._registerDimensionChangeListeners(), this.register((0, a3.toDisposable)(() => {
              this._canvas?.remove();
            }));
          }
          _registerDecorationListeners() {
            this.register(this._decorationService.onDecorationRegistered(() => this._queueRefresh(void 0, true))), this.register(this._decorationService.onDecorationRemoved(() => this._queueRefresh(void 0, true)));
          }
          _registerBufferChangeListeners() {
            this.register(this._renderService.onRenderedViewportChange(() => this._queueRefresh())), this.register(this._bufferService.buffers.onBufferActivate(() => {
              this._canvas.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? "none" : "block";
            })), this.register(this._bufferService.onScroll(() => {
              this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length && (this._refreshDrawHeightConstants(), this._refreshColorZonePadding());
            }));
          }
          _registerDimensionChangeListeners() {
            this.register(this._renderService.onRender(() => {
              this._containerHeight && this._containerHeight === this._screenElement.clientHeight || (this._queueRefresh(true), this._containerHeight = this._screenElement.clientHeight);
            })), this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth", () => this._queueRefresh(true))), this.register(this._coreBrowserService.onDprChange(() => this._queueRefresh(true))), this._queueRefresh(true);
          }
          _refreshDrawConstants() {
            const e5 = Math.floor(this._canvas.width / 3), t5 = Math.ceil(this._canvas.width / 3);
            l3.full = this._canvas.width, l3.left = e5, l3.center = t5, l3.right = e5, this._refreshDrawHeightConstants(), d3.full = 0, d3.left = 0, d3.center = l3.left, d3.right = l3.left + l3.center;
          }
          _refreshDrawHeightConstants() {
            c3.full = Math.round(2 * this._coreBrowserService.dpr);
            const e5 = this._canvas.height / this._bufferService.buffer.lines.length, t5 = Math.round(Math.max(Math.min(e5, 12), 6) * this._coreBrowserService.dpr);
            c3.left = t5, c3.center = t5, c3.right = t5;
          }
          _refreshColorZonePadding() {
            this._colorZoneStore.setPadding({ full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c3.full), left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c3.left), center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c3.center), right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c3.right) }), this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
          }
          _refreshCanvasDimensions() {
            this._canvas.style.width = `${this._width}px`, this._canvas.width = Math.round(this._width * this._coreBrowserService.dpr), this._canvas.style.height = `${this._screenElement.clientHeight}px`, this._canvas.height = Math.round(this._screenElement.clientHeight * this._coreBrowserService.dpr), this._refreshDrawConstants(), this._refreshColorZonePadding();
          }
          _refreshDecorations() {
            this._shouldUpdateDimensions && this._refreshCanvasDimensions(), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height), this._colorZoneStore.clear();
            for (const e6 of this._decorationService.decorations) this._colorZoneStore.addDecoration(e6);
            this._ctx.lineWidth = 1;
            const e5 = this._colorZoneStore.zones;
            for (const t5 of e5) "full" !== t5.position && this._renderColorZone(t5);
            for (const t5 of e5) "full" === t5.position && this._renderColorZone(t5);
            this._shouldUpdateDimensions = false, this._shouldUpdateAnchor = false;
          }
          _renderColorZone(e5) {
            this._ctx.fillStyle = e5.color, this._ctx.fillRect(d3[e5.position || "full"], Math.round((this._canvas.height - 1) * (e5.startBufferLine / this._bufferService.buffers.active.lines.length) - c3[e5.position || "full"] / 2), l3[e5.position || "full"], Math.round((this._canvas.height - 1) * ((e5.endBufferLine - e5.startBufferLine) / this._bufferService.buffers.active.lines.length) + c3[e5.position || "full"]));
          }
          _queueRefresh(e5, t5) {
            this._shouldUpdateDimensions = e5 || this._shouldUpdateDimensions, this._shouldUpdateAnchor = t5 || this._shouldUpdateAnchor, void 0 === this._animationFrame && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => {
              this._refreshDecorations(), this._animationFrame = void 0;
            }));
          }
        };
        t4.OverviewRulerRenderer = _2 = s4([r3(2, h3.IBufferService), r3(3, h3.IDecorationService), r3(4, o3.IRenderService), r3(5, h3.IOptionsService), r3(6, o3.ICoreBrowserService)], _2);
      }, 2950: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CompositionHelper = void 0;
        const n2 = i5(4725), o3 = i5(2585), a3 = i5(2584);
        let h3 = t4.CompositionHelper = class {
          get isComposing() {
            return this._isComposing;
          }
          constructor(e5, t5, i6, s5, r4, n3) {
            this._textarea = e5, this._compositionView = t5, this._bufferService = i6, this._optionsService = s5, this._coreService = r4, this._renderService = n3, this._isComposing = false, this._isSendingComposition = false, this._compositionPosition = { start: 0, end: 0 }, this._dataAlreadySent = "";
          }
          compositionstart() {
            this._isComposing = true, this._compositionPosition.start = this._textarea.value.length, this._compositionView.textContent = "", this._dataAlreadySent = "", this._compositionView.classList.add("active");
          }
          compositionupdate(e5) {
            this._compositionView.textContent = e5.data, this.updateCompositionElements(), setTimeout(() => {
              this._compositionPosition.end = this._textarea.value.length;
            }, 0);
          }
          compositionend() {
            this._finalizeComposition(true);
          }
          keydown(e5) {
            if (this._isComposing || this._isSendingComposition) {
              if (229 === e5.keyCode) return false;
              if (16 === e5.keyCode || 17 === e5.keyCode || 18 === e5.keyCode) return false;
              this._finalizeComposition(false);
            }
            return 229 !== e5.keyCode || (this._handleAnyTextareaChanges(), false);
          }
          _finalizeComposition(e5) {
            if (this._compositionView.classList.remove("active"), this._isComposing = false, e5) {
              const e6 = { start: this._compositionPosition.start, end: this._compositionPosition.end };
              this._isSendingComposition = true, setTimeout(() => {
                if (this._isSendingComposition) {
                  let t5;
                  this._isSendingComposition = false, e6.start += this._dataAlreadySent.length, t5 = this._isComposing ? this._textarea.value.substring(e6.start, e6.end) : this._textarea.value.substring(e6.start), t5.length > 0 && this._coreService.triggerDataEvent(t5, true);
                }
              }, 0);
            } else {
              this._isSendingComposition = false;
              const e6 = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
              this._coreService.triggerDataEvent(e6, true);
            }
          }
          _handleAnyTextareaChanges() {
            const e5 = this._textarea.value;
            setTimeout(() => {
              if (!this._isComposing) {
                const t5 = this._textarea.value, i6 = t5.replace(e5, "");
                this._dataAlreadySent = i6, t5.length > e5.length ? this._coreService.triggerDataEvent(i6, true) : t5.length < e5.length ? this._coreService.triggerDataEvent(`${a3.C0.DEL}`, true) : t5.length === e5.length && t5 !== e5 && this._coreService.triggerDataEvent(t5, true);
              }
            }, 0);
          }
          updateCompositionElements(e5) {
            if (this._isComposing) {
              if (this._bufferService.buffer.isCursorInViewport) {
                const e6 = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), t5 = this._renderService.dimensions.css.cell.height, i6 = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, s5 = e6 * this._renderService.dimensions.css.cell.width;
                this._compositionView.style.left = s5 + "px", this._compositionView.style.top = i6 + "px", this._compositionView.style.height = t5 + "px", this._compositionView.style.lineHeight = t5 + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
                const r4 = this._compositionView.getBoundingClientRect();
                this._textarea.style.left = s5 + "px", this._textarea.style.top = i6 + "px", this._textarea.style.width = Math.max(r4.width, 1) + "px", this._textarea.style.height = Math.max(r4.height, 1) + "px", this._textarea.style.lineHeight = r4.height + "px";
              }
              e5 || setTimeout(() => this.updateCompositionElements(true), 0);
            }
          }
        };
        t4.CompositionHelper = h3 = s4([r3(2, o3.IBufferService), r3(3, o3.IOptionsService), r3(4, o3.ICoreService), r3(5, n2.IRenderService)], h3);
      }, 9806: (e4, t4) => {
        function i5(e5, t5, i6) {
          const s4 = i6.getBoundingClientRect(), r3 = e5.getComputedStyle(i6), n2 = parseInt(r3.getPropertyValue("padding-left")), o3 = parseInt(r3.getPropertyValue("padding-top"));
          return [t5.clientX - s4.left - n2, t5.clientY - s4.top - o3];
        }
        Object.defineProperty(t4, "__esModule", { value: true }), t4.getCoords = t4.getCoordsRelativeToElement = void 0, t4.getCoordsRelativeToElement = i5, t4.getCoords = function(e5, t5, s4, r3, n2, o3, a3, h3, c3) {
          if (!o3) return;
          const l3 = i5(e5, t5, s4);
          return l3 ? (l3[0] = Math.ceil((l3[0] + (c3 ? a3 / 2 : 0)) / a3), l3[1] = Math.ceil(l3[1] / h3), l3[0] = Math.min(Math.max(l3[0], 1), r3 + (c3 ? 1 : 0)), l3[1] = Math.min(Math.max(l3[1], 1), n2), l3) : void 0;
        };
      }, 9504: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.moveToCellSequence = void 0;
        const s4 = i5(2584);
        function r3(e5, t5, i6, s5) {
          const r4 = e5 - n2(e5, i6), a4 = t5 - n2(t5, i6), l3 = Math.abs(r4 - a4) - function(e6, t6, i7) {
            let s6 = 0;
            const r5 = e6 - n2(e6, i7), a5 = t6 - n2(t6, i7);
            for (let n3 = 0; n3 < Math.abs(r5 - a5); n3++) {
              const a6 = "A" === o3(e6, t6) ? -1 : 1, h4 = i7.buffer.lines.get(r5 + a6 * n3);
              h4?.isWrapped && s6++;
            }
            return s6;
          }(e5, t5, i6);
          return c3(l3, h3(o3(e5, t5), s5));
        }
        function n2(e5, t5) {
          let i6 = 0, s5 = t5.buffer.lines.get(e5), r4 = s5?.isWrapped;
          for (; r4 && e5 >= 0 && e5 < t5.rows; ) i6++, s5 = t5.buffer.lines.get(--e5), r4 = s5?.isWrapped;
          return i6;
        }
        function o3(e5, t5) {
          return e5 > t5 ? "A" : "B";
        }
        function a3(e5, t5, i6, s5, r4, n3) {
          let o4 = e5, a4 = t5, h4 = "";
          for (; o4 !== i6 || a4 !== s5; ) o4 += r4 ? 1 : -1, r4 && o4 > n3.cols - 1 ? (h4 += n3.buffer.translateBufferLineToString(a4, false, e5, o4), o4 = 0, e5 = 0, a4++) : !r4 && o4 < 0 && (h4 += n3.buffer.translateBufferLineToString(a4, false, 0, e5 + 1), o4 = n3.cols - 1, e5 = o4, a4--);
          return h4 + n3.buffer.translateBufferLineToString(a4, false, e5, o4);
        }
        function h3(e5, t5) {
          const i6 = t5 ? "O" : "[";
          return s4.C0.ESC + i6 + e5;
        }
        function c3(e5, t5) {
          e5 = Math.floor(e5);
          let i6 = "";
          for (let s5 = 0; s5 < e5; s5++) i6 += t5;
          return i6;
        }
        t4.moveToCellSequence = function(e5, t5, i6, s5) {
          const o4 = i6.buffer.x, l3 = i6.buffer.y;
          if (!i6.buffer.hasScrollback) return function(e6, t6, i7, s6, o5, l4) {
            return 0 === r3(t6, s6, o5, l4).length ? "" : c3(a3(e6, t6, e6, t6 - n2(t6, o5), false, o5).length, h3("D", l4));
          }(o4, l3, 0, t5, i6, s5) + r3(l3, t5, i6, s5) + function(e6, t6, i7, s6, o5, l4) {
            let d4;
            d4 = r3(t6, s6, o5, l4).length > 0 ? s6 - n2(s6, o5) : t6;
            const _3 = s6, u4 = function(e7, t7, i8, s7, o6, a4) {
              let h4;
              return h4 = r3(i8, s7, o6, a4).length > 0 ? s7 - n2(s7, o6) : t7, e7 < i8 && h4 <= s7 || e7 >= i8 && h4 < s7 ? "C" : "D";
            }(e6, t6, i7, s6, o5, l4);
            return c3(a3(e6, d4, i7, _3, "C" === u4, o5).length, h3(u4, l4));
          }(o4, l3, e5, t5, i6, s5);
          let d3;
          if (l3 === t5) return d3 = o4 > e5 ? "D" : "C", c3(Math.abs(o4 - e5), h3(d3, s5));
          d3 = l3 > t5 ? "D" : "C";
          const _2 = Math.abs(l3 - t5);
          return c3(function(e6, t6) {
            return t6.cols - e6;
          }(l3 > t5 ? e5 : o4, i6) + (_2 - 1) * i6.cols + 1 + ((l3 > t5 ? o4 : e5) - 1), h3(d3, s5));
        };
      }, 1296: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.DomRenderer = void 0;
        const n2 = i5(3787), o3 = i5(2550), a3 = i5(2223), h3 = i5(6171), c3 = i5(6052), l3 = i5(4725), d3 = i5(8055), _2 = i5(8460), u4 = i5(844), f4 = i5(2585), v3 = "xterm-dom-renderer-owner-", p3 = "xterm-rows", g2 = "xterm-fg-", m3 = "xterm-bg-", S2 = "xterm-focus", C3 = "xterm-selection";
        let b2 = 1, w3 = t4.DomRenderer = class extends u4.Disposable {
          constructor(e5, t5, i6, s5, r4, a4, l4, d4, f5, g3, m4, S3, w4) {
            super(), this._terminal = e5, this._document = t5, this._element = i6, this._screenElement = s5, this._viewportElement = r4, this._helperContainer = a4, this._linkifier2 = l4, this._charSizeService = f5, this._optionsService = g3, this._bufferService = m4, this._coreBrowserService = S3, this._themeService = w4, this._terminalClass = b2++, this._rowElements = [], this._selectionRenderModel = (0, c3.createSelectionRenderModel)(), this.onRequestRedraw = this.register(new _2.EventEmitter()).event, this._rowContainer = this._document.createElement("div"), this._rowContainer.classList.add(p3), this._rowContainer.style.lineHeight = "normal", this._rowContainer.setAttribute("aria-hidden", "true"), this._refreshRowElements(this._bufferService.cols, this._bufferService.rows), this._selectionContainer = this._document.createElement("div"), this._selectionContainer.classList.add(C3), this._selectionContainer.setAttribute("aria-hidden", "true"), this.dimensions = (0, h3.createRenderDimensions)(), this._updateDimensions(), this.register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this.register(this._themeService.onChangeColors((e6) => this._injectCss(e6))), this._injectCss(this._themeService.colors), this._rowFactory = d4.createInstance(n2.DomRendererRowFactory, document), this._element.classList.add(v3 + this._terminalClass), this._screenElement.appendChild(this._rowContainer), this._screenElement.appendChild(this._selectionContainer), this.register(this._linkifier2.onShowLinkUnderline((e6) => this._handleLinkHover(e6))), this.register(this._linkifier2.onHideLinkUnderline((e6) => this._handleLinkLeave(e6))), this.register((0, u4.toDisposable)(() => {
              this._element.classList.remove(v3 + this._terminalClass), this._rowContainer.remove(), this._selectionContainer.remove(), this._widthCache.dispose(), this._themeStyleElement.remove(), this._dimensionsStyleElement.remove();
            })), this._widthCache = new o3.WidthCache(this._document, this._helperContainer), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
          }
          _updateDimensions() {
            const e5 = this._coreBrowserService.dpr;
            this.dimensions.device.char.width = this._charSizeService.width * e5, this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * e5), this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing), this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight), this.dimensions.device.char.left = 0, this.dimensions.device.char.top = 0, this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols, this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows, this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / e5), this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / e5), this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols, this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
            for (const e6 of this._rowElements) e6.style.width = `${this.dimensions.css.canvas.width}px`, e6.style.height = `${this.dimensions.css.cell.height}px`, e6.style.lineHeight = `${this.dimensions.css.cell.height}px`, e6.style.overflow = "hidden";
            this._dimensionsStyleElement || (this._dimensionsStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._dimensionsStyleElement));
            const t5 = `${this._terminalSelector} .${p3} span { display: inline-block; height: 100%; vertical-align: top;}`;
            this._dimensionsStyleElement.textContent = t5, this._selectionContainer.style.height = this._viewportElement.style.height, this._screenElement.style.width = `${this.dimensions.css.canvas.width}px`, this._screenElement.style.height = `${this.dimensions.css.canvas.height}px`;
          }
          _injectCss(e5) {
            this._themeStyleElement || (this._themeStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._themeStyleElement));
            let t5 = `${this._terminalSelector} .${p3} { color: ${e5.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;
            t5 += `${this._terminalSelector} .${p3} .xterm-dim { color: ${d3.color.multiplyOpacity(e5.foreground, 0.5).css};}`, t5 += `${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`;
            const i6 = `blink_underline_${this._terminalClass}`, s5 = `blink_bar_${this._terminalClass}`, r4 = `blink_block_${this._terminalClass}`;
            t5 += `@keyframes ${i6} { 50% {  border-bottom-style: hidden; }}`, t5 += `@keyframes ${s5} { 50% {  box-shadow: none; }}`, t5 += `@keyframes ${r4} { 0% {  background-color: ${e5.cursor.css};  color: ${e5.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e5.cursor.css}; }}`, t5 += `${this._terminalSelector} .${p3}.${S2} .xterm-cursor.xterm-cursor-blink.xterm-cursor-underline { animation: ${i6} 1s step-end infinite;}${this._terminalSelector} .${p3}.${S2} .xterm-cursor.xterm-cursor-blink.xterm-cursor-bar { animation: ${s5} 1s step-end infinite;}${this._terminalSelector} .${p3}.${S2} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: ${r4} 1s step-end infinite;}${this._terminalSelector} .${p3} .xterm-cursor.xterm-cursor-block { background-color: ${e5.cursor.css}; color: ${e5.cursorAccent.css};}${this._terminalSelector} .${p3} .xterm-cursor.xterm-cursor-block:not(.xterm-cursor-blink) { background-color: ${e5.cursor.css} !important; color: ${e5.cursorAccent.css} !important;}${this._terminalSelector} .${p3} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e5.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${p3} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e5.cursor.css} inset;}${this._terminalSelector} .${p3} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e5.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`, t5 += `${this._terminalSelector} .${C3} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${C3} div { position: absolute; background-color: ${e5.selectionBackgroundOpaque.css};}${this._terminalSelector} .${C3} div { position: absolute; background-color: ${e5.selectionInactiveBackgroundOpaque.css};}`;
            for (const [i7, s6] of e5.ansi.entries()) t5 += `${this._terminalSelector} .${g2}${i7} { color: ${s6.css}; }${this._terminalSelector} .${g2}${i7}.xterm-dim { color: ${d3.color.multiplyOpacity(s6, 0.5).css}; }${this._terminalSelector} .${m3}${i7} { background-color: ${s6.css}; }`;
            t5 += `${this._terminalSelector} .${g2}${a3.INVERTED_DEFAULT_COLOR} { color: ${d3.color.opaque(e5.background).css}; }${this._terminalSelector} .${g2}${a3.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${d3.color.multiplyOpacity(d3.color.opaque(e5.background), 0.5).css}; }${this._terminalSelector} .${m3}${a3.INVERTED_DEFAULT_COLOR} { background-color: ${e5.foreground.css}; }`, this._themeStyleElement.textContent = t5;
          }
          _setDefaultSpacing() {
            const e5 = this.dimensions.css.cell.width - this._widthCache.get("W", false, false);
            this._rowContainer.style.letterSpacing = `${e5}px`, this._rowFactory.defaultSpacing = e5;
          }
          handleDevicePixelRatioChange() {
            this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
          }
          _refreshRowElements(e5, t5) {
            for (let e6 = this._rowElements.length; e6 <= t5; e6++) {
              const e7 = this._document.createElement("div");
              this._rowContainer.appendChild(e7), this._rowElements.push(e7);
            }
            for (; this._rowElements.length > t5; ) this._rowContainer.removeChild(this._rowElements.pop());
          }
          handleResize(e5, t5) {
            this._refreshRowElements(e5, t5), this._updateDimensions(), this.handleSelectionChanged(this._selectionRenderModel.selectionStart, this._selectionRenderModel.selectionEnd, this._selectionRenderModel.columnSelectMode);
          }
          handleCharSizeChanged() {
            this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
          }
          handleBlur() {
            this._rowContainer.classList.remove(S2), this.renderRows(0, this._bufferService.rows - 1);
          }
          handleFocus() {
            this._rowContainer.classList.add(S2), this.renderRows(this._bufferService.buffer.y, this._bufferService.buffer.y);
          }
          handleSelectionChanged(e5, t5, i6) {
            if (this._selectionContainer.replaceChildren(), this._rowFactory.handleSelectionChanged(e5, t5, i6), this.renderRows(0, this._bufferService.rows - 1), !e5 || !t5) return;
            this._selectionRenderModel.update(this._terminal, e5, t5, i6);
            const s5 = this._selectionRenderModel.viewportStartRow, r4 = this._selectionRenderModel.viewportEndRow, n3 = this._selectionRenderModel.viewportCappedStartRow, o4 = this._selectionRenderModel.viewportCappedEndRow;
            if (n3 >= this._bufferService.rows || o4 < 0) return;
            const a4 = this._document.createDocumentFragment();
            if (i6) {
              const i7 = e5[0] > t5[0];
              a4.appendChild(this._createSelectionElement(n3, i7 ? t5[0] : e5[0], i7 ? e5[0] : t5[0], o4 - n3 + 1));
            } else {
              const i7 = s5 === n3 ? e5[0] : 0, h4 = n3 === r4 ? t5[0] : this._bufferService.cols;
              a4.appendChild(this._createSelectionElement(n3, i7, h4));
              const c4 = o4 - n3 - 1;
              if (a4.appendChild(this._createSelectionElement(n3 + 1, 0, this._bufferService.cols, c4)), n3 !== o4) {
                const e6 = r4 === o4 ? t5[0] : this._bufferService.cols;
                a4.appendChild(this._createSelectionElement(o4, 0, e6));
              }
            }
            this._selectionContainer.appendChild(a4);
          }
          _createSelectionElement(e5, t5, i6, s5 = 1) {
            const r4 = this._document.createElement("div"), n3 = t5 * this.dimensions.css.cell.width;
            let o4 = this.dimensions.css.cell.width * (i6 - t5);
            return n3 + o4 > this.dimensions.css.canvas.width && (o4 = this.dimensions.css.canvas.width - n3), r4.style.height = s5 * this.dimensions.css.cell.height + "px", r4.style.top = e5 * this.dimensions.css.cell.height + "px", r4.style.left = `${n3}px`, r4.style.width = `${o4}px`, r4;
          }
          handleCursorMove() {
          }
          _handleOptionsChanged() {
            this._updateDimensions(), this._injectCss(this._themeService.colors), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
          }
          clear() {
            for (const e5 of this._rowElements) e5.replaceChildren();
          }
          renderRows(e5, t5) {
            const i6 = this._bufferService.buffer, s5 = i6.ybase + i6.y, r4 = Math.min(i6.x, this._bufferService.cols - 1), n3 = this._optionsService.rawOptions.cursorBlink, o4 = this._optionsService.rawOptions.cursorStyle, a4 = this._optionsService.rawOptions.cursorInactiveStyle;
            for (let h4 = e5; h4 <= t5; h4++) {
              const e6 = h4 + i6.ydisp, t6 = this._rowElements[h4], c4 = i6.lines.get(e6);
              if (!t6 || !c4) break;
              t6.replaceChildren(...this._rowFactory.createRow(c4, e6, e6 === s5, o4, a4, r4, n3, this.dimensions.css.cell.width, this._widthCache, -1, -1));
            }
          }
          get _terminalSelector() {
            return `.${v3}${this._terminalClass}`;
          }
          _handleLinkHover(e5) {
            this._setCellUnderline(e5.x1, e5.x2, e5.y1, e5.y2, e5.cols, true);
          }
          _handleLinkLeave(e5) {
            this._setCellUnderline(e5.x1, e5.x2, e5.y1, e5.y2, e5.cols, false);
          }
          _setCellUnderline(e5, t5, i6, s5, r4, n3) {
            i6 < 0 && (e5 = 0), s5 < 0 && (t5 = 0);
            const o4 = this._bufferService.rows - 1;
            i6 = Math.max(Math.min(i6, o4), 0), s5 = Math.max(Math.min(s5, o4), 0), r4 = Math.min(r4, this._bufferService.cols);
            const a4 = this._bufferService.buffer, h4 = a4.ybase + a4.y, c4 = Math.min(a4.x, r4 - 1), l4 = this._optionsService.rawOptions.cursorBlink, d4 = this._optionsService.rawOptions.cursorStyle, _3 = this._optionsService.rawOptions.cursorInactiveStyle;
            for (let o5 = i6; o5 <= s5; ++o5) {
              const u5 = o5 + a4.ydisp, f5 = this._rowElements[o5], v4 = a4.lines.get(u5);
              if (!f5 || !v4) break;
              f5.replaceChildren(...this._rowFactory.createRow(v4, u5, u5 === h4, d4, _3, c4, l4, this.dimensions.css.cell.width, this._widthCache, n3 ? o5 === i6 ? e5 : 0 : -1, n3 ? (o5 === s5 ? t5 : r4) - 1 : -1));
            }
          }
        };
        t4.DomRenderer = w3 = s4([r3(7, f4.IInstantiationService), r3(8, l3.ICharSizeService), r3(9, f4.IOptionsService), r3(10, f4.IBufferService), r3(11, l3.ICoreBrowserService), r3(12, l3.IThemeService)], w3);
      }, 3787: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.DomRendererRowFactory = void 0;
        const n2 = i5(2223), o3 = i5(643), a3 = i5(511), h3 = i5(2585), c3 = i5(8055), l3 = i5(4725), d3 = i5(4269), _2 = i5(6171), u4 = i5(3734);
        let f4 = t4.DomRendererRowFactory = class {
          constructor(e5, t5, i6, s5, r4, n3, o4) {
            this._document = e5, this._characterJoinerService = t5, this._optionsService = i6, this._coreBrowserService = s5, this._coreService = r4, this._decorationService = n3, this._themeService = o4, this._workCell = new a3.CellData(), this._columnSelectMode = false, this.defaultSpacing = 0;
          }
          handleSelectionChanged(e5, t5, i6) {
            this._selectionStart = e5, this._selectionEnd = t5, this._columnSelectMode = i6;
          }
          createRow(e5, t5, i6, s5, r4, a4, h4, l4, _3, f5, p3) {
            const g2 = [], m3 = this._characterJoinerService.getJoinedCharacters(t5), S2 = this._themeService.colors;
            let C3, b2 = e5.getNoBgTrimmedLength();
            i6 && b2 < a4 + 1 && (b2 = a4 + 1);
            let w3 = 0, y3 = "", E2 = 0, k3 = 0, L2 = 0, D3 = false, R2 = 0, x2 = false, A3 = 0;
            const B3 = [], T3 = -1 !== f5 && -1 !== p3;
            for (let M = 0; M < b2; M++) {
              e5.loadCell(M, this._workCell);
              let b3 = this._workCell.getWidth();
              if (0 === b3) continue;
              let O2 = false, P2 = M, I2 = this._workCell;
              if (m3.length > 0 && M === m3[0][0]) {
                O2 = true;
                const t6 = m3.shift();
                I2 = new d3.JoinedCellData(this._workCell, e5.translateToString(true, t6[0], t6[1]), t6[1] - t6[0]), P2 = t6[1] - 1, b3 = I2.getWidth();
              }
              const H2 = this._isCellInSelection(M, t5), F = i6 && M === a4, W = T3 && M >= f5 && M <= p3;
              let U = false;
              this._decorationService.forEachDecorationAtCell(M, t5, void 0, (e6) => {
                U = true;
              });
              let N2 = I2.getChars() || o3.WHITESPACE_CELL_CHAR;
              if (" " === N2 && (I2.isUnderline() || I2.isOverline()) && (N2 = "\xA0"), A3 = b3 * l4 - _3.get(N2, I2.isBold(), I2.isItalic()), C3) {
                if (w3 && (H2 && x2 || !H2 && !x2 && I2.bg === E2) && (H2 && x2 && S2.selectionForeground || I2.fg === k3) && I2.extended.ext === L2 && W === D3 && A3 === R2 && !F && !O2 && !U) {
                  I2.isInvisible() ? y3 += o3.WHITESPACE_CELL_CHAR : y3 += N2, w3++;
                  continue;
                }
                w3 && (C3.textContent = y3), C3 = this._document.createElement("span"), w3 = 0, y3 = "";
              } else C3 = this._document.createElement("span");
              if (E2 = I2.bg, k3 = I2.fg, L2 = I2.extended.ext, D3 = W, R2 = A3, x2 = H2, O2 && a4 >= M && a4 <= P2 && (a4 = M), !this._coreService.isCursorHidden && F && this._coreService.isCursorInitialized) {
                if (B3.push("xterm-cursor"), this._coreBrowserService.isFocused) h4 && B3.push("xterm-cursor-blink"), B3.push("bar" === s5 ? "xterm-cursor-bar" : "underline" === s5 ? "xterm-cursor-underline" : "xterm-cursor-block");
                else if (r4) switch (r4) {
                  case "outline":
                    B3.push("xterm-cursor-outline");
                    break;
                  case "block":
                    B3.push("xterm-cursor-block");
                    break;
                  case "bar":
                    B3.push("xterm-cursor-bar");
                    break;
                  case "underline":
                    B3.push("xterm-cursor-underline");
                }
              }
              if (I2.isBold() && B3.push("xterm-bold"), I2.isItalic() && B3.push("xterm-italic"), I2.isDim() && B3.push("xterm-dim"), y3 = I2.isInvisible() ? o3.WHITESPACE_CELL_CHAR : I2.getChars() || o3.WHITESPACE_CELL_CHAR, I2.isUnderline() && (B3.push(`xterm-underline-${I2.extended.underlineStyle}`), " " === y3 && (y3 = "\xA0"), !I2.isUnderlineColorDefault())) if (I2.isUnderlineColorRGB()) C3.style.textDecorationColor = `rgb(${u4.AttributeData.toColorRGB(I2.getUnderlineColor()).join(",")})`;
              else {
                let e6 = I2.getUnderlineColor();
                this._optionsService.rawOptions.drawBoldTextInBrightColors && I2.isBold() && e6 < 8 && (e6 += 8), C3.style.textDecorationColor = S2.ansi[e6].css;
              }
              I2.isOverline() && (B3.push("xterm-overline"), " " === y3 && (y3 = "\xA0")), I2.isStrikethrough() && B3.push("xterm-strikethrough"), W && (C3.style.textDecoration = "underline");
              let $2 = I2.getFgColor(), j3 = I2.getFgColorMode(), z3 = I2.getBgColor(), K2 = I2.getBgColorMode();
              const q2 = !!I2.isInverse();
              if (q2) {
                const e6 = $2;
                $2 = z3, z3 = e6;
                const t6 = j3;
                j3 = K2, K2 = t6;
              }
              let V2, G2, X, J2 = false;
              switch (this._decorationService.forEachDecorationAtCell(M, t5, void 0, (e6) => {
                "top" !== e6.options.layer && J2 || (e6.backgroundColorRGB && (K2 = 50331648, z3 = e6.backgroundColorRGB.rgba >> 8 & 16777215, V2 = e6.backgroundColorRGB), e6.foregroundColorRGB && (j3 = 50331648, $2 = e6.foregroundColorRGB.rgba >> 8 & 16777215, G2 = e6.foregroundColorRGB), J2 = "top" === e6.options.layer);
              }), !J2 && H2 && (V2 = this._coreBrowserService.isFocused ? S2.selectionBackgroundOpaque : S2.selectionInactiveBackgroundOpaque, z3 = V2.rgba >> 8 & 16777215, K2 = 50331648, J2 = true, S2.selectionForeground && (j3 = 50331648, $2 = S2.selectionForeground.rgba >> 8 & 16777215, G2 = S2.selectionForeground)), J2 && B3.push("xterm-decoration-top"), K2) {
                case 16777216:
                case 33554432:
                  X = S2.ansi[z3], B3.push(`xterm-bg-${z3}`);
                  break;
                case 50331648:
                  X = c3.channels.toColor(z3 >> 16, z3 >> 8 & 255, 255 & z3), this._addStyle(C3, `background-color:#${v3((z3 >>> 0).toString(16), "0", 6)}`);
                  break;
                default:
                  q2 ? (X = S2.foreground, B3.push(`xterm-bg-${n2.INVERTED_DEFAULT_COLOR}`)) : X = S2.background;
              }
              switch (V2 || I2.isDim() && (V2 = c3.color.multiplyOpacity(X, 0.5)), j3) {
                case 16777216:
                case 33554432:
                  I2.isBold() && $2 < 8 && this._optionsService.rawOptions.drawBoldTextInBrightColors && ($2 += 8), this._applyMinimumContrast(C3, X, S2.ansi[$2], I2, V2, void 0) || B3.push(`xterm-fg-${$2}`);
                  break;
                case 50331648:
                  const e6 = c3.channels.toColor($2 >> 16 & 255, $2 >> 8 & 255, 255 & $2);
                  this._applyMinimumContrast(C3, X, e6, I2, V2, G2) || this._addStyle(C3, `color:#${v3($2.toString(16), "0", 6)}`);
                  break;
                default:
                  this._applyMinimumContrast(C3, X, S2.foreground, I2, V2, G2) || q2 && B3.push(`xterm-fg-${n2.INVERTED_DEFAULT_COLOR}`);
              }
              B3.length && (C3.className = B3.join(" "), B3.length = 0), F || O2 || U ? C3.textContent = y3 : w3++, A3 !== this.defaultSpacing && (C3.style.letterSpacing = `${A3}px`), g2.push(C3), M = P2;
            }
            return C3 && w3 && (C3.textContent = y3), g2;
          }
          _applyMinimumContrast(e5, t5, i6, s5, r4, n3) {
            if (1 === this._optionsService.rawOptions.minimumContrastRatio || (0, _2.treatGlyphAsBackgroundColor)(s5.getCode())) return false;
            const o4 = this._getContrastCache(s5);
            let a4;
            if (r4 || n3 || (a4 = o4.getColor(t5.rgba, i6.rgba)), void 0 === a4) {
              const e6 = this._optionsService.rawOptions.minimumContrastRatio / (s5.isDim() ? 2 : 1);
              a4 = c3.color.ensureContrastRatio(r4 || t5, n3 || i6, e6), o4.setColor((r4 || t5).rgba, (n3 || i6).rgba, a4 ?? null);
            }
            return !!a4 && (this._addStyle(e5, `color:${a4.css}`), true);
          }
          _getContrastCache(e5) {
            return e5.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
          }
          _addStyle(e5, t5) {
            e5.setAttribute("style", `${e5.getAttribute("style") || ""}${t5};`);
          }
          _isCellInSelection(e5, t5) {
            const i6 = this._selectionStart, s5 = this._selectionEnd;
            return !(!i6 || !s5) && (this._columnSelectMode ? i6[0] <= s5[0] ? e5 >= i6[0] && t5 >= i6[1] && e5 < s5[0] && t5 <= s5[1] : e5 < i6[0] && t5 >= i6[1] && e5 >= s5[0] && t5 <= s5[1] : t5 > i6[1] && t5 < s5[1] || i6[1] === s5[1] && t5 === i6[1] && e5 >= i6[0] && e5 < s5[0] || i6[1] < s5[1] && t5 === s5[1] && e5 < s5[0] || i6[1] < s5[1] && t5 === i6[1] && e5 >= i6[0]);
          }
        };
        function v3(e5, t5, i6) {
          for (; e5.length < i6; ) e5 = t5 + e5;
          return e5;
        }
        t4.DomRendererRowFactory = f4 = s4([r3(1, l3.ICharacterJoinerService), r3(2, h3.IOptionsService), r3(3, l3.ICoreBrowserService), r3(4, h3.ICoreService), r3(5, h3.IDecorationService), r3(6, l3.IThemeService)], f4);
      }, 2550: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.WidthCache = void 0, t4.WidthCache = class {
          constructor(e5, t5) {
            this._flat = new Float32Array(256), this._font = "", this._fontSize = 0, this._weight = "normal", this._weightBold = "bold", this._measureElements = [], this._container = e5.createElement("div"), this._container.classList.add("xterm-width-cache-measure-container"), this._container.setAttribute("aria-hidden", "true"), this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
            const i5 = e5.createElement("span");
            i5.classList.add("xterm-char-measure-element");
            const s4 = e5.createElement("span");
            s4.classList.add("xterm-char-measure-element"), s4.style.fontWeight = "bold";
            const r3 = e5.createElement("span");
            r3.classList.add("xterm-char-measure-element"), r3.style.fontStyle = "italic";
            const n2 = e5.createElement("span");
            n2.classList.add("xterm-char-measure-element"), n2.style.fontWeight = "bold", n2.style.fontStyle = "italic", this._measureElements = [i5, s4, r3, n2], this._container.appendChild(i5), this._container.appendChild(s4), this._container.appendChild(r3), this._container.appendChild(n2), t5.appendChild(this._container), this.clear();
          }
          dispose() {
            this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
          }
          clear() {
            this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
          }
          setFont(e5, t5, i5, s4) {
            e5 === this._font && t5 === this._fontSize && i5 === this._weight && s4 === this._weightBold || (this._font = e5, this._fontSize = t5, this._weight = i5, this._weightBold = s4, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i5}`, this._measureElements[1].style.fontWeight = `${s4}`, this._measureElements[2].style.fontWeight = `${i5}`, this._measureElements[3].style.fontWeight = `${s4}`, this.clear());
          }
          get(e5, t5, i5) {
            let s4 = 0;
            if (!t5 && !i5 && 1 === e5.length && (s4 = e5.charCodeAt(0)) < 256) {
              if (-9999 !== this._flat[s4]) return this._flat[s4];
              const t6 = this._measure(e5, 0);
              return t6 > 0 && (this._flat[s4] = t6), t6;
            }
            let r3 = e5;
            t5 && (r3 += "B"), i5 && (r3 += "I");
            let n2 = this._holey.get(r3);
            if (void 0 === n2) {
              let s5 = 0;
              t5 && (s5 |= 1), i5 && (s5 |= 2), n2 = this._measure(e5, s5), n2 > 0 && this._holey.set(r3, n2);
            }
            return n2;
          }
          _measure(e5, t5) {
            const i5 = this._measureElements[t5];
            return i5.textContent = e5.repeat(32), i5.offsetWidth / 32;
          }
        };
      }, 2223: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.TEXT_BASELINE = t4.DIM_OPACITY = t4.INVERTED_DEFAULT_COLOR = void 0;
        const s4 = i5(6114);
        t4.INVERTED_DEFAULT_COLOR = 257, t4.DIM_OPACITY = 0.5, t4.TEXT_BASELINE = s4.isFirefox || s4.isLegacyEdge ? "bottom" : "ideographic";
      }, 6171: (e4, t4) => {
        function i5(e5) {
          return 57508 <= e5 && e5 <= 57558;
        }
        function s4(e5) {
          return e5 >= 128512 && e5 <= 128591 || e5 >= 127744 && e5 <= 128511 || e5 >= 128640 && e5 <= 128767 || e5 >= 9728 && e5 <= 9983 || e5 >= 9984 && e5 <= 10175 || e5 >= 65024 && e5 <= 65039 || e5 >= 129280 && e5 <= 129535 || e5 >= 127462 && e5 <= 127487;
        }
        Object.defineProperty(t4, "__esModule", { value: true }), t4.computeNextVariantOffset = t4.createRenderDimensions = t4.treatGlyphAsBackgroundColor = t4.allowRescaling = t4.isEmoji = t4.isRestrictedPowerlineGlyph = t4.isPowerlineGlyph = t4.throwIfFalsy = void 0, t4.throwIfFalsy = function(e5) {
          if (!e5) throw new Error("value must not be falsy");
          return e5;
        }, t4.isPowerlineGlyph = i5, t4.isRestrictedPowerlineGlyph = function(e5) {
          return 57520 <= e5 && e5 <= 57527;
        }, t4.isEmoji = s4, t4.allowRescaling = function(e5, t5, r3, n2) {
          return 1 === t5 && r3 > Math.ceil(1.5 * n2) && void 0 !== e5 && e5 > 255 && !s4(e5) && !i5(e5) && !function(e6) {
            return 57344 <= e6 && e6 <= 63743;
          }(e5);
        }, t4.treatGlyphAsBackgroundColor = function(e5) {
          return i5(e5) || function(e6) {
            return 9472 <= e6 && e6 <= 9631;
          }(e5);
        }, t4.createRenderDimensions = function() {
          return { css: { canvas: { width: 0, height: 0 }, cell: { width: 0, height: 0 } }, device: { canvas: { width: 0, height: 0 }, cell: { width: 0, height: 0 }, char: { width: 0, height: 0, left: 0, top: 0 } } };
        }, t4.computeNextVariantOffset = function(e5, t5, i6 = 0) {
          return (e5 - (2 * Math.round(t5) - i6)) % (2 * Math.round(t5));
        };
      }, 6052: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.createSelectionRenderModel = void 0;
        class i5 {
          constructor() {
            this.clear();
          }
          clear() {
            this.hasSelection = false, this.columnSelectMode = false, this.viewportStartRow = 0, this.viewportEndRow = 0, this.viewportCappedStartRow = 0, this.viewportCappedEndRow = 0, this.startCol = 0, this.endCol = 0, this.selectionStart = void 0, this.selectionEnd = void 0;
          }
          update(e5, t5, i6, s4 = false) {
            if (this.selectionStart = t5, this.selectionEnd = i6, !t5 || !i6 || t5[0] === i6[0] && t5[1] === i6[1]) return void this.clear();
            const r3 = e5.buffers.active.ydisp, n2 = t5[1] - r3, o3 = i6[1] - r3, a3 = Math.max(n2, 0), h3 = Math.min(o3, e5.rows - 1);
            a3 >= e5.rows || h3 < 0 ? this.clear() : (this.hasSelection = true, this.columnSelectMode = s4, this.viewportStartRow = n2, this.viewportEndRow = o3, this.viewportCappedStartRow = a3, this.viewportCappedEndRow = h3, this.startCol = t5[0], this.endCol = i6[0]);
          }
          isCellSelected(e5, t5, i6) {
            return !!this.hasSelection && (i6 -= e5.buffer.active.viewportY, this.columnSelectMode ? this.startCol <= this.endCol ? t5 >= this.startCol && i6 >= this.viewportCappedStartRow && t5 < this.endCol && i6 <= this.viewportCappedEndRow : t5 < this.startCol && i6 >= this.viewportCappedStartRow && t5 >= this.endCol && i6 <= this.viewportCappedEndRow : i6 > this.viewportStartRow && i6 < this.viewportEndRow || this.viewportStartRow === this.viewportEndRow && i6 === this.viewportStartRow && t5 >= this.startCol && t5 < this.endCol || this.viewportStartRow < this.viewportEndRow && i6 === this.viewportEndRow && t5 < this.endCol || this.viewportStartRow < this.viewportEndRow && i6 === this.viewportStartRow && t5 >= this.startCol);
          }
        }
        t4.createSelectionRenderModel = function() {
          return new i5();
        };
      }, 456: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.SelectionModel = void 0, t4.SelectionModel = class {
          constructor(e5) {
            this._bufferService = e5, this.isSelectAllActive = false, this.selectionStartLength = 0;
          }
          clearSelection() {
            this.selectionStart = void 0, this.selectionEnd = void 0, this.isSelectAllActive = false, this.selectionStartLength = 0;
          }
          get finalSelectionStart() {
            return this.isSelectAllActive ? [0, 0] : this.selectionEnd && this.selectionStart && this.areSelectionValuesReversed() ? this.selectionEnd : this.selectionStart;
          }
          get finalSelectionEnd() {
            if (this.isSelectAllActive) return [this._bufferService.cols, this._bufferService.buffer.ybase + this._bufferService.rows - 1];
            if (this.selectionStart) {
              if (!this.selectionEnd || this.areSelectionValuesReversed()) {
                const e5 = this.selectionStart[0] + this.selectionStartLength;
                return e5 > this._bufferService.cols ? e5 % this._bufferService.cols == 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(e5 / this._bufferService.cols) - 1] : [e5 % this._bufferService.cols, this.selectionStart[1] + Math.floor(e5 / this._bufferService.cols)] : [e5, this.selectionStart[1]];
              }
              if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
                const e5 = this.selectionStart[0] + this.selectionStartLength;
                return e5 > this._bufferService.cols ? [e5 % this._bufferService.cols, this.selectionStart[1] + Math.floor(e5 / this._bufferService.cols)] : [Math.max(e5, this.selectionEnd[0]), this.selectionEnd[1]];
              }
              return this.selectionEnd;
            }
          }
          areSelectionValuesReversed() {
            const e5 = this.selectionStart, t5 = this.selectionEnd;
            return !(!e5 || !t5) && (e5[1] > t5[1] || e5[1] === t5[1] && e5[0] > t5[0]);
          }
          handleTrim(e5) {
            return this.selectionStart && (this.selectionStart[1] -= e5), this.selectionEnd && (this.selectionEnd[1] -= e5), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), true) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), false);
          }
        };
      }, 428: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CharSizeService = void 0;
        const n2 = i5(2585), o3 = i5(8460), a3 = i5(844);
        let h3 = t4.CharSizeService = class extends a3.Disposable {
          get hasValidSize() {
            return this.width > 0 && this.height > 0;
          }
          constructor(e5, t5, i6) {
            super(), this._optionsService = i6, this.width = 0, this.height = 0, this._onCharSizeChange = this.register(new o3.EventEmitter()), this.onCharSizeChange = this._onCharSizeChange.event;
            try {
              this._measureStrategy = this.register(new d3(this._optionsService));
            } catch {
              this._measureStrategy = this.register(new l3(e5, t5, this._optionsService));
            }
            this.register(this._optionsService.onMultipleOptionChange(["fontFamily", "fontSize"], () => this.measure()));
          }
          measure() {
            const e5 = this._measureStrategy.measure();
            e5.width === this.width && e5.height === this.height || (this.width = e5.width, this.height = e5.height, this._onCharSizeChange.fire());
          }
        };
        t4.CharSizeService = h3 = s4([r3(2, n2.IOptionsService)], h3);
        class c3 extends a3.Disposable {
          constructor() {
            super(...arguments), this._result = { width: 0, height: 0 };
          }
          _validateAndSet(e5, t5) {
            void 0 !== e5 && e5 > 0 && void 0 !== t5 && t5 > 0 && (this._result.width = e5, this._result.height = t5);
          }
        }
        class l3 extends c3 {
          constructor(e5, t5, i6) {
            super(), this._document = e5, this._parentElement = t5, this._optionsService = i6, this._measureElement = this._document.createElement("span"), this._measureElement.classList.add("xterm-char-measure-element"), this._measureElement.textContent = "W".repeat(32), this._measureElement.setAttribute("aria-hidden", "true"), this._measureElement.style.whiteSpace = "pre", this._measureElement.style.fontKerning = "none", this._parentElement.appendChild(this._measureElement);
          }
          measure() {
            return this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._measureElement.style.fontSize = `${this._optionsService.rawOptions.fontSize}px`, this._validateAndSet(Number(this._measureElement.offsetWidth) / 32, Number(this._measureElement.offsetHeight)), this._result;
          }
        }
        class d3 extends c3 {
          constructor(e5) {
            super(), this._optionsService = e5, this._canvas = new OffscreenCanvas(100, 100), this._ctx = this._canvas.getContext("2d");
            const t5 = this._ctx.measureText("W");
            if (!("width" in t5 && "fontBoundingBoxAscent" in t5 && "fontBoundingBoxDescent" in t5)) throw new Error("Required font metrics not supported");
          }
          measure() {
            this._ctx.font = `${this._optionsService.rawOptions.fontSize}px ${this._optionsService.rawOptions.fontFamily}`;
            const e5 = this._ctx.measureText("W");
            return this._validateAndSet(e5.width, e5.fontBoundingBoxAscent + e5.fontBoundingBoxDescent), this._result;
          }
        }
      }, 4269: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CharacterJoinerService = t4.JoinedCellData = void 0;
        const n2 = i5(3734), o3 = i5(643), a3 = i5(511), h3 = i5(2585);
        class c3 extends n2.AttributeData {
          constructor(e5, t5, i6) {
            super(), this.content = 0, this.combinedData = "", this.fg = e5.fg, this.bg = e5.bg, this.combinedData = t5, this._width = i6;
          }
          isCombined() {
            return 2097152;
          }
          getWidth() {
            return this._width;
          }
          getChars() {
            return this.combinedData;
          }
          getCode() {
            return 2097151;
          }
          setFromCharData(e5) {
            throw new Error("not implemented");
          }
          getAsCharData() {
            return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
          }
        }
        t4.JoinedCellData = c3;
        let l3 = t4.CharacterJoinerService = class e5 {
          constructor(e6) {
            this._bufferService = e6, this._characterJoiners = [], this._nextCharacterJoinerId = 0, this._workCell = new a3.CellData();
          }
          register(e6) {
            const t5 = { id: this._nextCharacterJoinerId++, handler: e6 };
            return this._characterJoiners.push(t5), t5.id;
          }
          deregister(e6) {
            for (let t5 = 0; t5 < this._characterJoiners.length; t5++) if (this._characterJoiners[t5].id === e6) return this._characterJoiners.splice(t5, 1), true;
            return false;
          }
          getJoinedCharacters(e6) {
            if (0 === this._characterJoiners.length) return [];
            const t5 = this._bufferService.buffer.lines.get(e6);
            if (!t5 || 0 === t5.length) return [];
            const i6 = [], s5 = t5.translateToString(true);
            let r4 = 0, n3 = 0, a4 = 0, h4 = t5.getFg(0), c4 = t5.getBg(0);
            for (let e7 = 0; e7 < t5.getTrimmedLength(); e7++) if (t5.loadCell(e7, this._workCell), 0 !== this._workCell.getWidth()) {
              if (this._workCell.fg !== h4 || this._workCell.bg !== c4) {
                if (e7 - r4 > 1) {
                  const e8 = this._getJoinedRanges(s5, a4, n3, t5, r4);
                  for (let t6 = 0; t6 < e8.length; t6++) i6.push(e8[t6]);
                }
                r4 = e7, a4 = n3, h4 = this._workCell.fg, c4 = this._workCell.bg;
              }
              n3 += this._workCell.getChars().length || o3.WHITESPACE_CELL_CHAR.length;
            }
            if (this._bufferService.cols - r4 > 1) {
              const e7 = this._getJoinedRanges(s5, a4, n3, t5, r4);
              for (let t6 = 0; t6 < e7.length; t6++) i6.push(e7[t6]);
            }
            return i6;
          }
          _getJoinedRanges(t5, i6, s5, r4, n3) {
            const o4 = t5.substring(i6, s5);
            let a4 = [];
            try {
              a4 = this._characterJoiners[0].handler(o4);
            } catch (e6) {
              console.error(e6);
            }
            for (let t6 = 1; t6 < this._characterJoiners.length; t6++) try {
              const i7 = this._characterJoiners[t6].handler(o4);
              for (let t7 = 0; t7 < i7.length; t7++) e5._mergeRanges(a4, i7[t7]);
            } catch (e6) {
              console.error(e6);
            }
            return this._stringRangesToCellRanges(a4, r4, n3), a4;
          }
          _stringRangesToCellRanges(e6, t5, i6) {
            let s5 = 0, r4 = false, n3 = 0, a4 = e6[s5];
            if (a4) {
              for (let h4 = i6; h4 < this._bufferService.cols; h4++) {
                const i7 = t5.getWidth(h4), c4 = t5.getString(h4).length || o3.WHITESPACE_CELL_CHAR.length;
                if (0 !== i7) {
                  if (!r4 && a4[0] <= n3 && (a4[0] = h4, r4 = true), a4[1] <= n3) {
                    if (a4[1] = h4, a4 = e6[++s5], !a4) break;
                    a4[0] <= n3 ? (a4[0] = h4, r4 = true) : r4 = false;
                  }
                  n3 += c4;
                }
              }
              a4 && (a4[1] = this._bufferService.cols);
            }
          }
          static _mergeRanges(e6, t5) {
            let i6 = false;
            for (let s5 = 0; s5 < e6.length; s5++) {
              const r4 = e6[s5];
              if (i6) {
                if (t5[1] <= r4[0]) return e6[s5 - 1][1] = t5[1], e6;
                if (t5[1] <= r4[1]) return e6[s5 - 1][1] = Math.max(t5[1], r4[1]), e6.splice(s5, 1), e6;
                e6.splice(s5, 1), s5--;
              } else {
                if (t5[1] <= r4[0]) return e6.splice(s5, 0, t5), e6;
                if (t5[1] <= r4[1]) return r4[0] = Math.min(t5[0], r4[0]), e6;
                t5[0] < r4[1] && (r4[0] = Math.min(t5[0], r4[0]), i6 = true);
              }
            }
            return i6 ? e6[e6.length - 1][1] = t5[1] : e6.push(t5), e6;
          }
        };
        t4.CharacterJoinerService = l3 = s4([r3(0, h3.IBufferService)], l3);
      }, 5114: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CoreBrowserService = void 0;
        const s4 = i5(844), r3 = i5(8460), n2 = i5(3656);
        class o3 extends s4.Disposable {
          constructor(e5, t5, i6) {
            super(), this._textarea = e5, this._window = t5, this.mainDocument = i6, this._isFocused = false, this._cachedIsFocused = void 0, this._screenDprMonitor = new a3(this._window), this._onDprChange = this.register(new r3.EventEmitter()), this.onDprChange = this._onDprChange.event, this._onWindowChange = this.register(new r3.EventEmitter()), this.onWindowChange = this._onWindowChange.event, this.register(this.onWindowChange((e6) => this._screenDprMonitor.setWindow(e6))), this.register((0, r3.forwardEvent)(this._screenDprMonitor.onDprChange, this._onDprChange)), this._textarea.addEventListener("focus", () => this._isFocused = true), this._textarea.addEventListener("blur", () => this._isFocused = false);
          }
          get window() {
            return this._window;
          }
          set window(e5) {
            this._window !== e5 && (this._window = e5, this._onWindowChange.fire(this._window));
          }
          get dpr() {
            return this.window.devicePixelRatio;
          }
          get isFocused() {
            return void 0 === this._cachedIsFocused && (this._cachedIsFocused = this._isFocused && this._textarea.ownerDocument.hasFocus(), queueMicrotask(() => this._cachedIsFocused = void 0)), this._cachedIsFocused;
          }
        }
        t4.CoreBrowserService = o3;
        class a3 extends s4.Disposable {
          constructor(e5) {
            super(), this._parentWindow = e5, this._windowResizeListener = this.register(new s4.MutableDisposable()), this._onDprChange = this.register(new r3.EventEmitter()), this.onDprChange = this._onDprChange.event, this._outerListener = () => this._setDprAndFireIfDiffers(), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._updateDpr(), this._setWindowResizeListener(), this.register((0, s4.toDisposable)(() => this.clearListener()));
          }
          setWindow(e5) {
            this._parentWindow = e5, this._setWindowResizeListener(), this._setDprAndFireIfDiffers();
          }
          _setWindowResizeListener() {
            this._windowResizeListener.value = (0, n2.addDisposableDomListener)(this._parentWindow, "resize", () => this._setDprAndFireIfDiffers());
          }
          _setDprAndFireIfDiffers() {
            this._parentWindow.devicePixelRatio !== this._currentDevicePixelRatio && this._onDprChange.fire(this._parentWindow.devicePixelRatio), this._updateDpr();
          }
          _updateDpr() {
            this._outerListener && (this._resolutionMediaMatchList?.removeListener(this._outerListener), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._resolutionMediaMatchList = this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`), this._resolutionMediaMatchList.addListener(this._outerListener));
          }
          clearListener() {
            this._resolutionMediaMatchList && this._outerListener && (this._resolutionMediaMatchList.removeListener(this._outerListener), this._resolutionMediaMatchList = void 0, this._outerListener = void 0);
          }
        }
      }, 779: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.LinkProviderService = void 0;
        const s4 = i5(844);
        class r3 extends s4.Disposable {
          constructor() {
            super(), this.linkProviders = [], this.register((0, s4.toDisposable)(() => this.linkProviders.length = 0));
          }
          registerLinkProvider(e5) {
            return this.linkProviders.push(e5), { dispose: () => {
              const t5 = this.linkProviders.indexOf(e5);
              -1 !== t5 && this.linkProviders.splice(t5, 1);
            } };
          }
        }
        t4.LinkProviderService = r3;
      }, 8934: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.MouseService = void 0;
        const n2 = i5(4725), o3 = i5(9806);
        let a3 = t4.MouseService = class {
          constructor(e5, t5) {
            this._renderService = e5, this._charSizeService = t5;
          }
          getCoords(e5, t5, i6, s5, r4) {
            return (0, o3.getCoords)(window, e5, t5, i6, s5, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, r4);
          }
          getMouseReportCoords(e5, t5) {
            const i6 = (0, o3.getCoordsRelativeToElement)(window, e5, t5);
            if (this._charSizeService.hasValidSize) return i6[0] = Math.min(Math.max(i6[0], 0), this._renderService.dimensions.css.canvas.width - 1), i6[1] = Math.min(Math.max(i6[1], 0), this._renderService.dimensions.css.canvas.height - 1), { col: Math.floor(i6[0] / this._renderService.dimensions.css.cell.width), row: Math.floor(i6[1] / this._renderService.dimensions.css.cell.height), x: Math.floor(i6[0]), y: Math.floor(i6[1]) };
          }
        };
        t4.MouseService = a3 = s4([r3(0, n2.IRenderService), r3(1, n2.ICharSizeService)], a3);
      }, 3230: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.RenderService = void 0;
        const n2 = i5(6193), o3 = i5(4725), a3 = i5(8460), h3 = i5(844), c3 = i5(7226), l3 = i5(2585);
        let d3 = t4.RenderService = class extends h3.Disposable {
          get dimensions() {
            return this._renderer.value.dimensions;
          }
          constructor(e5, t5, i6, s5, r4, o4, l4, d4) {
            super(), this._rowCount = e5, this._charSizeService = s5, this._renderer = this.register(new h3.MutableDisposable()), this._pausedResizeTask = new c3.DebouncedIdleTask(), this._observerDisposable = this.register(new h3.MutableDisposable()), this._isPaused = false, this._needsFullRefresh = false, this._isNextRenderRedrawOnly = true, this._needsSelectionRefresh = false, this._canvasWidth = 0, this._canvasHeight = 0, this._selectionState = { start: void 0, end: void 0, columnSelectMode: false }, this._onDimensionsChange = this.register(new a3.EventEmitter()), this.onDimensionsChange = this._onDimensionsChange.event, this._onRenderedViewportChange = this.register(new a3.EventEmitter()), this.onRenderedViewportChange = this._onRenderedViewportChange.event, this._onRender = this.register(new a3.EventEmitter()), this.onRender = this._onRender.event, this._onRefreshRequest = this.register(new a3.EventEmitter()), this.onRefreshRequest = this._onRefreshRequest.event, this._renderDebouncer = new n2.RenderDebouncer((e6, t6) => this._renderRows(e6, t6), l4), this.register(this._renderDebouncer), this.register(l4.onDprChange(() => this.handleDevicePixelRatioChange())), this.register(o4.onResize(() => this._fullRefresh())), this.register(o4.buffers.onBufferActivate(() => this._renderer.value?.clear())), this.register(i6.onOptionChange(() => this._handleOptionsChanged())), this.register(this._charSizeService.onCharSizeChange(() => this.handleCharSizeChanged())), this.register(r4.onDecorationRegistered(() => this._fullRefresh())), this.register(r4.onDecorationRemoved(() => this._fullRefresh())), this.register(i6.onMultipleOptionChange(["customGlyphs", "drawBoldTextInBrightColors", "letterSpacing", "lineHeight", "fontFamily", "fontSize", "fontWeight", "fontWeightBold", "minimumContrastRatio", "rescaleOverlappingGlyphs"], () => {
              this.clear(), this.handleResize(o4.cols, o4.rows), this._fullRefresh();
            })), this.register(i6.onMultipleOptionChange(["cursorBlink", "cursorStyle"], () => this.refreshRows(o4.buffer.y, o4.buffer.y, true))), this.register(d4.onChangeColors(() => this._fullRefresh())), this._registerIntersectionObserver(l4.window, t5), this.register(l4.onWindowChange((e6) => this._registerIntersectionObserver(e6, t5)));
          }
          _registerIntersectionObserver(e5, t5) {
            if ("IntersectionObserver" in e5) {
              const i6 = new e5.IntersectionObserver((e6) => this._handleIntersectionChange(e6[e6.length - 1]), { threshold: 0 });
              i6.observe(t5), this._observerDisposable.value = (0, h3.toDisposable)(() => i6.disconnect());
            }
          }
          _handleIntersectionChange(e5) {
            this._isPaused = void 0 === e5.isIntersecting ? 0 === e5.intersectionRatio : !e5.isIntersecting, this._isPaused || this._charSizeService.hasValidSize || this._charSizeService.measure(), !this._isPaused && this._needsFullRefresh && (this._pausedResizeTask.flush(), this.refreshRows(0, this._rowCount - 1), this._needsFullRefresh = false);
          }
          refreshRows(e5, t5, i6 = false) {
            this._isPaused ? this._needsFullRefresh = true : (i6 || (this._isNextRenderRedrawOnly = false), this._renderDebouncer.refresh(e5, t5, this._rowCount));
          }
          _renderRows(e5, t5) {
            this._renderer.value && (e5 = Math.min(e5, this._rowCount - 1), t5 = Math.min(t5, this._rowCount - 1), this._renderer.value.renderRows(e5, t5), this._needsSelectionRefresh && (this._renderer.value.handleSelectionChanged(this._selectionState.start, this._selectionState.end, this._selectionState.columnSelectMode), this._needsSelectionRefresh = false), this._isNextRenderRedrawOnly || this._onRenderedViewportChange.fire({ start: e5, end: t5 }), this._onRender.fire({ start: e5, end: t5 }), this._isNextRenderRedrawOnly = true);
          }
          resize(e5, t5) {
            this._rowCount = t5, this._fireOnCanvasResize();
          }
          _handleOptionsChanged() {
            this._renderer.value && (this.refreshRows(0, this._rowCount - 1), this._fireOnCanvasResize());
          }
          _fireOnCanvasResize() {
            this._renderer.value && (this._renderer.value.dimensions.css.canvas.width === this._canvasWidth && this._renderer.value.dimensions.css.canvas.height === this._canvasHeight || this._onDimensionsChange.fire(this._renderer.value.dimensions));
          }
          hasRenderer() {
            return !!this._renderer.value;
          }
          setRenderer(e5) {
            this._renderer.value = e5, this._renderer.value && (this._renderer.value.onRequestRedraw((e6) => this.refreshRows(e6.start, e6.end, true)), this._needsSelectionRefresh = true, this._fullRefresh());
          }
          addRefreshCallback(e5) {
            return this._renderDebouncer.addRefreshCallback(e5);
          }
          _fullRefresh() {
            this._isPaused ? this._needsFullRefresh = true : this.refreshRows(0, this._rowCount - 1);
          }
          clearTextureAtlas() {
            this._renderer.value && (this._renderer.value.clearTextureAtlas?.(), this._fullRefresh());
          }
          handleDevicePixelRatioChange() {
            this._charSizeService.measure(), this._renderer.value && (this._renderer.value.handleDevicePixelRatioChange(), this.refreshRows(0, this._rowCount - 1));
          }
          handleResize(e5, t5) {
            this._renderer.value && (this._isPaused ? this._pausedResizeTask.set(() => this._renderer.value?.handleResize(e5, t5)) : this._renderer.value.handleResize(e5, t5), this._fullRefresh());
          }
          handleCharSizeChanged() {
            this._renderer.value?.handleCharSizeChanged();
          }
          handleBlur() {
            this._renderer.value?.handleBlur();
          }
          handleFocus() {
            this._renderer.value?.handleFocus();
          }
          handleSelectionChanged(e5, t5, i6) {
            this._selectionState.start = e5, this._selectionState.end = t5, this._selectionState.columnSelectMode = i6, this._renderer.value?.handleSelectionChanged(e5, t5, i6);
          }
          handleCursorMove() {
            this._renderer.value?.handleCursorMove();
          }
          clear() {
            this._renderer.value?.clear();
          }
        };
        t4.RenderService = d3 = s4([r3(2, l3.IOptionsService), r3(3, o3.ICharSizeService), r3(4, l3.IDecorationService), r3(5, l3.IBufferService), r3(6, o3.ICoreBrowserService), r3(7, o3.IThemeService)], d3);
      }, 9312: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.SelectionService = void 0;
        const n2 = i5(9806), o3 = i5(9504), a3 = i5(456), h3 = i5(4725), c3 = i5(8460), l3 = i5(844), d3 = i5(6114), _2 = i5(4841), u4 = i5(511), f4 = i5(2585), v3 = String.fromCharCode(160), p3 = new RegExp(v3, "g");
        let g2 = t4.SelectionService = class extends l3.Disposable {
          constructor(e5, t5, i6, s5, r4, n3, o4, h4, d4) {
            super(), this._element = e5, this._screenElement = t5, this._linkifier = i6, this._bufferService = s5, this._coreService = r4, this._mouseService = n3, this._optionsService = o4, this._renderService = h4, this._coreBrowserService = d4, this._dragScrollAmount = 0, this._enabled = true, this._workCell = new u4.CellData(), this._mouseDownTimeStamp = 0, this._oldHasSelection = false, this._oldSelectionStart = void 0, this._oldSelectionEnd = void 0, this._onLinuxMouseSelection = this.register(new c3.EventEmitter()), this.onLinuxMouseSelection = this._onLinuxMouseSelection.event, this._onRedrawRequest = this.register(new c3.EventEmitter()), this.onRequestRedraw = this._onRedrawRequest.event, this._onSelectionChange = this.register(new c3.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onRequestScrollLines = this.register(new c3.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this._mouseMoveListener = (e6) => this._handleMouseMove(e6), this._mouseUpListener = (e6) => this._handleMouseUp(e6), this._coreService.onUserInput(() => {
              this.hasSelection && this.clearSelection();
            }), this._trimListener = this._bufferService.buffer.lines.onTrim((e6) => this._handleTrim(e6)), this.register(this._bufferService.buffers.onBufferActivate((e6) => this._handleBufferActivate(e6))), this.enable(), this._model = new a3.SelectionModel(this._bufferService), this._activeSelectionMode = 0, this.register((0, l3.toDisposable)(() => {
              this._removeMouseDownListeners();
            }));
          }
          reset() {
            this.clearSelection();
          }
          disable() {
            this.clearSelection(), this._enabled = false;
          }
          enable() {
            this._enabled = true;
          }
          get selectionStart() {
            return this._model.finalSelectionStart;
          }
          get selectionEnd() {
            return this._model.finalSelectionEnd;
          }
          get hasSelection() {
            const e5 = this._model.finalSelectionStart, t5 = this._model.finalSelectionEnd;
            return !(!e5 || !t5 || e5[0] === t5[0] && e5[1] === t5[1]);
          }
          get selectionText() {
            const e5 = this._model.finalSelectionStart, t5 = this._model.finalSelectionEnd;
            if (!e5 || !t5) return "";
            const i6 = this._bufferService.buffer, s5 = [];
            if (3 === this._activeSelectionMode) {
              if (e5[0] === t5[0]) return "";
              const r4 = e5[0] < t5[0] ? e5[0] : t5[0], n3 = e5[0] < t5[0] ? t5[0] : e5[0];
              for (let o4 = e5[1]; o4 <= t5[1]; o4++) {
                const e6 = i6.translateBufferLineToString(o4, true, r4, n3);
                s5.push(e6);
              }
            } else {
              const r4 = e5[1] === t5[1] ? t5[0] : void 0;
              s5.push(i6.translateBufferLineToString(e5[1], true, e5[0], r4));
              for (let r5 = e5[1] + 1; r5 <= t5[1] - 1; r5++) {
                const e6 = i6.lines.get(r5), t6 = i6.translateBufferLineToString(r5, true);
                e6?.isWrapped ? s5[s5.length - 1] += t6 : s5.push(t6);
              }
              if (e5[1] !== t5[1]) {
                const e6 = i6.lines.get(t5[1]), r5 = i6.translateBufferLineToString(t5[1], true, 0, t5[0]);
                e6 && e6.isWrapped ? s5[s5.length - 1] += r5 : s5.push(r5);
              }
            }
            return s5.map((e6) => e6.replace(p3, " ")).join(d3.isWindows ? "\r\n" : "\n");
          }
          clearSelection() {
            this._model.clearSelection(), this._removeMouseDownListeners(), this.refresh(), this._onSelectionChange.fire();
          }
          refresh(e5) {
            this._refreshAnimationFrame || (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._refresh())), d3.isLinux && e5 && this.selectionText.length && this._onLinuxMouseSelection.fire(this.selectionText);
          }
          _refresh() {
            this._refreshAnimationFrame = void 0, this._onRedrawRequest.fire({ start: this._model.finalSelectionStart, end: this._model.finalSelectionEnd, columnSelectMode: 3 === this._activeSelectionMode });
          }
          _isClickInSelection(e5) {
            const t5 = this._getMouseBufferCoords(e5), i6 = this._model.finalSelectionStart, s5 = this._model.finalSelectionEnd;
            return !!(i6 && s5 && t5) && this._areCoordsInSelection(t5, i6, s5);
          }
          isCellInSelection(e5, t5) {
            const i6 = this._model.finalSelectionStart, s5 = this._model.finalSelectionEnd;
            return !(!i6 || !s5) && this._areCoordsInSelection([e5, t5], i6, s5);
          }
          _areCoordsInSelection(e5, t5, i6) {
            return e5[1] > t5[1] && e5[1] < i6[1] || t5[1] === i6[1] && e5[1] === t5[1] && e5[0] >= t5[0] && e5[0] < i6[0] || t5[1] < i6[1] && e5[1] === i6[1] && e5[0] < i6[0] || t5[1] < i6[1] && e5[1] === t5[1] && e5[0] >= t5[0];
          }
          _selectWordAtCursor(e5, t5) {
            const i6 = this._linkifier.currentLink?.link?.range;
            if (i6) return this._model.selectionStart = [i6.start.x - 1, i6.start.y - 1], this._model.selectionStartLength = (0, _2.getRangeLength)(i6, this._bufferService.cols), this._model.selectionEnd = void 0, true;
            const s5 = this._getMouseBufferCoords(e5);
            return !!s5 && (this._selectWordAt(s5, t5), this._model.selectionEnd = void 0, true);
          }
          selectAll() {
            this._model.isSelectAllActive = true, this.refresh(), this._onSelectionChange.fire();
          }
          selectLines(e5, t5) {
            this._model.clearSelection(), e5 = Math.max(e5, 0), t5 = Math.min(t5, this._bufferService.buffer.lines.length - 1), this._model.selectionStart = [0, e5], this._model.selectionEnd = [this._bufferService.cols, t5], this.refresh(), this._onSelectionChange.fire();
          }
          _handleTrim(e5) {
            this._model.handleTrim(e5) && this.refresh();
          }
          _getMouseBufferCoords(e5) {
            const t5 = this._mouseService.getCoords(e5, this._screenElement, this._bufferService.cols, this._bufferService.rows, true);
            if (t5) return t5[0]--, t5[1]--, t5[1] += this._bufferService.buffer.ydisp, t5;
          }
          _getMouseEventScrollAmount(e5) {
            let t5 = (0, n2.getCoordsRelativeToElement)(this._coreBrowserService.window, e5, this._screenElement)[1];
            const i6 = this._renderService.dimensions.css.canvas.height;
            return t5 >= 0 && t5 <= i6 ? 0 : (t5 > i6 && (t5 -= i6), t5 = Math.min(Math.max(t5, -50), 50), t5 /= 50, t5 / Math.abs(t5) + Math.round(14 * t5));
          }
          shouldForceSelection(e5) {
            return d3.isMac ? e5.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection : e5.shiftKey;
          }
          handleMouseDown(e5) {
            if (this._mouseDownTimeStamp = e5.timeStamp, (2 !== e5.button || !this.hasSelection) && 0 === e5.button) {
              if (!this._enabled) {
                if (!this.shouldForceSelection(e5)) return;
                e5.stopPropagation();
              }
              e5.preventDefault(), this._dragScrollAmount = 0, this._enabled && e5.shiftKey ? this._handleIncrementalClick(e5) : 1 === e5.detail ? this._handleSingleClick(e5) : 2 === e5.detail ? this._handleDoubleClick(e5) : 3 === e5.detail && this._handleTripleClick(e5), this._addMouseDownListeners(), this.refresh(true);
            }
          }
          _addMouseDownListeners() {
            this._screenElement.ownerDocument && (this._screenElement.ownerDocument.addEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.addEventListener("mouseup", this._mouseUpListener)), this._dragScrollIntervalTimer = this._coreBrowserService.window.setInterval(() => this._dragScroll(), 50);
          }
          _removeMouseDownListeners() {
            this._screenElement.ownerDocument && (this._screenElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.removeEventListener("mouseup", this._mouseUpListener)), this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer), this._dragScrollIntervalTimer = void 0;
          }
          _handleIncrementalClick(e5) {
            this._model.selectionStart && (this._model.selectionEnd = this._getMouseBufferCoords(e5));
          }
          _handleSingleClick(e5) {
            if (this._model.selectionStartLength = 0, this._model.isSelectAllActive = false, this._activeSelectionMode = this.shouldColumnSelect(e5) ? 3 : 0, this._model.selectionStart = this._getMouseBufferCoords(e5), !this._model.selectionStart) return;
            this._model.selectionEnd = void 0;
            const t5 = this._bufferService.buffer.lines.get(this._model.selectionStart[1]);
            t5 && t5.length !== this._model.selectionStart[0] && 0 === t5.hasWidth(this._model.selectionStart[0]) && this._model.selectionStart[0]++;
          }
          _handleDoubleClick(e5) {
            this._selectWordAtCursor(e5, true) && (this._activeSelectionMode = 1);
          }
          _handleTripleClick(e5) {
            const t5 = this._getMouseBufferCoords(e5);
            t5 && (this._activeSelectionMode = 2, this._selectLineAt(t5[1]));
          }
          shouldColumnSelect(e5) {
            return e5.altKey && !(d3.isMac && this._optionsService.rawOptions.macOptionClickForcesSelection);
          }
          _handleMouseMove(e5) {
            if (e5.stopImmediatePropagation(), !this._model.selectionStart) return;
            const t5 = this._model.selectionEnd ? [this._model.selectionEnd[0], this._model.selectionEnd[1]] : null;
            if (this._model.selectionEnd = this._getMouseBufferCoords(e5), !this._model.selectionEnd) return void this.refresh(true);
            2 === this._activeSelectionMode ? this._model.selectionEnd[1] < this._model.selectionStart[1] ? this._model.selectionEnd[0] = 0 : this._model.selectionEnd[0] = this._bufferService.cols : 1 === this._activeSelectionMode && this._selectToWordAt(this._model.selectionEnd), this._dragScrollAmount = this._getMouseEventScrollAmount(e5), 3 !== this._activeSelectionMode && (this._dragScrollAmount > 0 ? this._model.selectionEnd[0] = this._bufferService.cols : this._dragScrollAmount < 0 && (this._model.selectionEnd[0] = 0));
            const i6 = this._bufferService.buffer;
            if (this._model.selectionEnd[1] < i6.lines.length) {
              const e6 = i6.lines.get(this._model.selectionEnd[1]);
              e6 && 0 === e6.hasWidth(this._model.selectionEnd[0]) && this._model.selectionEnd[0] < this._bufferService.cols && this._model.selectionEnd[0]++;
            }
            t5 && t5[0] === this._model.selectionEnd[0] && t5[1] === this._model.selectionEnd[1] || this.refresh(true);
          }
          _dragScroll() {
            if (this._model.selectionEnd && this._model.selectionStart && this._dragScrollAmount) {
              this._onRequestScrollLines.fire({ amount: this._dragScrollAmount, suppressScrollEvent: false });
              const e5 = this._bufferService.buffer;
              this._dragScrollAmount > 0 ? (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = this._bufferService.cols), this._model.selectionEnd[1] = Math.min(e5.ydisp + this._bufferService.rows, e5.lines.length - 1)) : (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = 0), this._model.selectionEnd[1] = e5.ydisp), this.refresh();
            }
          }
          _handleMouseUp(e5) {
            const t5 = e5.timeStamp - this._mouseDownTimeStamp;
            if (this._removeMouseDownListeners(), this.selectionText.length <= 1 && t5 < 500 && e5.altKey && this._optionsService.rawOptions.altClickMovesCursor) {
              if (this._bufferService.buffer.ybase === this._bufferService.buffer.ydisp) {
                const t6 = this._mouseService.getCoords(e5, this._element, this._bufferService.cols, this._bufferService.rows, false);
                if (t6 && void 0 !== t6[0] && void 0 !== t6[1]) {
                  const e6 = (0, o3.moveToCellSequence)(t6[0] - 1, t6[1] - 1, this._bufferService, this._coreService.decPrivateModes.applicationCursorKeys);
                  this._coreService.triggerDataEvent(e6, true);
                }
              }
            } else this._fireEventIfSelectionChanged();
          }
          _fireEventIfSelectionChanged() {
            const e5 = this._model.finalSelectionStart, t5 = this._model.finalSelectionEnd, i6 = !(!e5 || !t5 || e5[0] === t5[0] && e5[1] === t5[1]);
            i6 ? e5 && t5 && (this._oldSelectionStart && this._oldSelectionEnd && e5[0] === this._oldSelectionStart[0] && e5[1] === this._oldSelectionStart[1] && t5[0] === this._oldSelectionEnd[0] && t5[1] === this._oldSelectionEnd[1] || this._fireOnSelectionChange(e5, t5, i6)) : this._oldHasSelection && this._fireOnSelectionChange(e5, t5, i6);
          }
          _fireOnSelectionChange(e5, t5, i6) {
            this._oldSelectionStart = e5, this._oldSelectionEnd = t5, this._oldHasSelection = i6, this._onSelectionChange.fire();
          }
          _handleBufferActivate(e5) {
            this.clearSelection(), this._trimListener.dispose(), this._trimListener = e5.activeBuffer.lines.onTrim((e6) => this._handleTrim(e6));
          }
          _convertViewportColToCharacterIndex(e5, t5) {
            let i6 = t5;
            for (let s5 = 0; t5 >= s5; s5++) {
              const r4 = e5.loadCell(s5, this._workCell).getChars().length;
              0 === this._workCell.getWidth() ? i6-- : r4 > 1 && t5 !== s5 && (i6 += r4 - 1);
            }
            return i6;
          }
          setSelection(e5, t5, i6) {
            this._model.clearSelection(), this._removeMouseDownListeners(), this._model.selectionStart = [e5, t5], this._model.selectionStartLength = i6, this.refresh(), this._fireEventIfSelectionChanged();
          }
          rightClickSelect(e5) {
            this._isClickInSelection(e5) || (this._selectWordAtCursor(e5, false) && this.refresh(true), this._fireEventIfSelectionChanged());
          }
          _getWordAt(e5, t5, i6 = true, s5 = true) {
            if (e5[0] >= this._bufferService.cols) return;
            const r4 = this._bufferService.buffer, n3 = r4.lines.get(e5[1]);
            if (!n3) return;
            const o4 = r4.translateBufferLineToString(e5[1], false);
            let a4 = this._convertViewportColToCharacterIndex(n3, e5[0]), h4 = a4;
            const c4 = e5[0] - a4;
            let l4 = 0, d4 = 0, _3 = 0, u5 = 0;
            if (" " === o4.charAt(a4)) {
              for (; a4 > 0 && " " === o4.charAt(a4 - 1); ) a4--;
              for (; h4 < o4.length && " " === o4.charAt(h4 + 1); ) h4++;
            } else {
              let t6 = e5[0], i7 = e5[0];
              0 === n3.getWidth(t6) && (l4++, t6--), 2 === n3.getWidth(i7) && (d4++, i7++);
              const s6 = n3.getString(i7).length;
              for (s6 > 1 && (u5 += s6 - 1, h4 += s6 - 1); t6 > 0 && a4 > 0 && !this._isCharWordSeparator(n3.loadCell(t6 - 1, this._workCell)); ) {
                n3.loadCell(t6 - 1, this._workCell);
                const e6 = this._workCell.getChars().length;
                0 === this._workCell.getWidth() ? (l4++, t6--) : e6 > 1 && (_3 += e6 - 1, a4 -= e6 - 1), a4--, t6--;
              }
              for (; i7 < n3.length && h4 + 1 < o4.length && !this._isCharWordSeparator(n3.loadCell(i7 + 1, this._workCell)); ) {
                n3.loadCell(i7 + 1, this._workCell);
                const e6 = this._workCell.getChars().length;
                2 === this._workCell.getWidth() ? (d4++, i7++) : e6 > 1 && (u5 += e6 - 1, h4 += e6 - 1), h4++, i7++;
              }
            }
            h4++;
            let f5 = a4 + c4 - l4 + _3, v4 = Math.min(this._bufferService.cols, h4 - a4 + l4 + d4 - _3 - u5);
            if (t5 || "" !== o4.slice(a4, h4).trim()) {
              if (i6 && 0 === f5 && 32 !== n3.getCodePoint(0)) {
                const t6 = r4.lines.get(e5[1] - 1);
                if (t6 && n3.isWrapped && 32 !== t6.getCodePoint(this._bufferService.cols - 1)) {
                  const t7 = this._getWordAt([this._bufferService.cols - 1, e5[1] - 1], false, true, false);
                  if (t7) {
                    const e6 = this._bufferService.cols - t7.start;
                    f5 -= e6, v4 += e6;
                  }
                }
              }
              if (s5 && f5 + v4 === this._bufferService.cols && 32 !== n3.getCodePoint(this._bufferService.cols - 1)) {
                const t6 = r4.lines.get(e5[1] + 1);
                if (t6?.isWrapped && 32 !== t6.getCodePoint(0)) {
                  const t7 = this._getWordAt([0, e5[1] + 1], false, false, true);
                  t7 && (v4 += t7.length);
                }
              }
              return { start: f5, length: v4 };
            }
          }
          _selectWordAt(e5, t5) {
            const i6 = this._getWordAt(e5, t5);
            if (i6) {
              for (; i6.start < 0; ) i6.start += this._bufferService.cols, e5[1]--;
              this._model.selectionStart = [i6.start, e5[1]], this._model.selectionStartLength = i6.length;
            }
          }
          _selectToWordAt(e5) {
            const t5 = this._getWordAt(e5, true);
            if (t5) {
              let i6 = e5[1];
              for (; t5.start < 0; ) t5.start += this._bufferService.cols, i6--;
              if (!this._model.areSelectionValuesReversed()) for (; t5.start + t5.length > this._bufferService.cols; ) t5.length -= this._bufferService.cols, i6++;
              this._model.selectionEnd = [this._model.areSelectionValuesReversed() ? t5.start : t5.start + t5.length, i6];
            }
          }
          _isCharWordSeparator(e5) {
            return 0 !== e5.getWidth() && this._optionsService.rawOptions.wordSeparator.indexOf(e5.getChars()) >= 0;
          }
          _selectLineAt(e5) {
            const t5 = this._bufferService.buffer.getWrappedRangeForLine(e5), i6 = { start: { x: 0, y: t5.first }, end: { x: this._bufferService.cols - 1, y: t5.last } };
            this._model.selectionStart = [0, t5.first], this._model.selectionEnd = void 0, this._model.selectionStartLength = (0, _2.getRangeLength)(i6, this._bufferService.cols);
          }
        };
        t4.SelectionService = g2 = s4([r3(3, f4.IBufferService), r3(4, f4.ICoreService), r3(5, h3.IMouseService), r3(6, f4.IOptionsService), r3(7, h3.IRenderService), r3(8, h3.ICoreBrowserService)], g2);
      }, 4725: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.ILinkProviderService = t4.IThemeService = t4.ICharacterJoinerService = t4.ISelectionService = t4.IRenderService = t4.IMouseService = t4.ICoreBrowserService = t4.ICharSizeService = void 0;
        const s4 = i5(8343);
        t4.ICharSizeService = (0, s4.createDecorator)("CharSizeService"), t4.ICoreBrowserService = (0, s4.createDecorator)("CoreBrowserService"), t4.IMouseService = (0, s4.createDecorator)("MouseService"), t4.IRenderService = (0, s4.createDecorator)("RenderService"), t4.ISelectionService = (0, s4.createDecorator)("SelectionService"), t4.ICharacterJoinerService = (0, s4.createDecorator)("CharacterJoinerService"), t4.IThemeService = (0, s4.createDecorator)("ThemeService"), t4.ILinkProviderService = (0, s4.createDecorator)("LinkProviderService");
      }, 6731: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.ThemeService = t4.DEFAULT_ANSI_COLORS = void 0;
        const n2 = i5(7239), o3 = i5(8055), a3 = i5(8460), h3 = i5(844), c3 = i5(2585), l3 = o3.css.toColor("#ffffff"), d3 = o3.css.toColor("#000000"), _2 = o3.css.toColor("#ffffff"), u4 = o3.css.toColor("#000000"), f4 = { css: "rgba(255, 255, 255, 0.3)", rgba: 4294967117 };
        t4.DEFAULT_ANSI_COLORS = Object.freeze((() => {
          const e5 = [o3.css.toColor("#2e3436"), o3.css.toColor("#cc0000"), o3.css.toColor("#4e9a06"), o3.css.toColor("#c4a000"), o3.css.toColor("#3465a4"), o3.css.toColor("#75507b"), o3.css.toColor("#06989a"), o3.css.toColor("#d3d7cf"), o3.css.toColor("#555753"), o3.css.toColor("#ef2929"), o3.css.toColor("#8ae234"), o3.css.toColor("#fce94f"), o3.css.toColor("#729fcf"), o3.css.toColor("#ad7fa8"), o3.css.toColor("#34e2e2"), o3.css.toColor("#eeeeec")], t5 = [0, 95, 135, 175, 215, 255];
          for (let i6 = 0; i6 < 216; i6++) {
            const s5 = t5[i6 / 36 % 6 | 0], r4 = t5[i6 / 6 % 6 | 0], n3 = t5[i6 % 6];
            e5.push({ css: o3.channels.toCss(s5, r4, n3), rgba: o3.channels.toRgba(s5, r4, n3) });
          }
          for (let t6 = 0; t6 < 24; t6++) {
            const i6 = 8 + 10 * t6;
            e5.push({ css: o3.channels.toCss(i6, i6, i6), rgba: o3.channels.toRgba(i6, i6, i6) });
          }
          return e5;
        })());
        let v3 = t4.ThemeService = class extends h3.Disposable {
          get colors() {
            return this._colors;
          }
          constructor(e5) {
            super(), this._optionsService = e5, this._contrastCache = new n2.ColorContrastCache(), this._halfContrastCache = new n2.ColorContrastCache(), this._onChangeColors = this.register(new a3.EventEmitter()), this.onChangeColors = this._onChangeColors.event, this._colors = { foreground: l3, background: d3, cursor: _2, cursorAccent: u4, selectionForeground: void 0, selectionBackgroundTransparent: f4, selectionBackgroundOpaque: o3.color.blend(d3, f4), selectionInactiveBackgroundTransparent: f4, selectionInactiveBackgroundOpaque: o3.color.blend(d3, f4), ansi: t4.DEFAULT_ANSI_COLORS.slice(), contrastCache: this._contrastCache, halfContrastCache: this._halfContrastCache }, this._updateRestoreColors(), this._setTheme(this._optionsService.rawOptions.theme), this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio", () => this._contrastCache.clear())), this.register(this._optionsService.onSpecificOptionChange("theme", () => this._setTheme(this._optionsService.rawOptions.theme)));
          }
          _setTheme(e5 = {}) {
            const i6 = this._colors;
            if (i6.foreground = p3(e5.foreground, l3), i6.background = p3(e5.background, d3), i6.cursor = p3(e5.cursor, _2), i6.cursorAccent = p3(e5.cursorAccent, u4), i6.selectionBackgroundTransparent = p3(e5.selectionBackground, f4), i6.selectionBackgroundOpaque = o3.color.blend(i6.background, i6.selectionBackgroundTransparent), i6.selectionInactiveBackgroundTransparent = p3(e5.selectionInactiveBackground, i6.selectionBackgroundTransparent), i6.selectionInactiveBackgroundOpaque = o3.color.blend(i6.background, i6.selectionInactiveBackgroundTransparent), i6.selectionForeground = e5.selectionForeground ? p3(e5.selectionForeground, o3.NULL_COLOR) : void 0, i6.selectionForeground === o3.NULL_COLOR && (i6.selectionForeground = void 0), o3.color.isOpaque(i6.selectionBackgroundTransparent)) {
              const e6 = 0.3;
              i6.selectionBackgroundTransparent = o3.color.opacity(i6.selectionBackgroundTransparent, e6);
            }
            if (o3.color.isOpaque(i6.selectionInactiveBackgroundTransparent)) {
              const e6 = 0.3;
              i6.selectionInactiveBackgroundTransparent = o3.color.opacity(i6.selectionInactiveBackgroundTransparent, e6);
            }
            if (i6.ansi = t4.DEFAULT_ANSI_COLORS.slice(), i6.ansi[0] = p3(e5.black, t4.DEFAULT_ANSI_COLORS[0]), i6.ansi[1] = p3(e5.red, t4.DEFAULT_ANSI_COLORS[1]), i6.ansi[2] = p3(e5.green, t4.DEFAULT_ANSI_COLORS[2]), i6.ansi[3] = p3(e5.yellow, t4.DEFAULT_ANSI_COLORS[3]), i6.ansi[4] = p3(e5.blue, t4.DEFAULT_ANSI_COLORS[4]), i6.ansi[5] = p3(e5.magenta, t4.DEFAULT_ANSI_COLORS[5]), i6.ansi[6] = p3(e5.cyan, t4.DEFAULT_ANSI_COLORS[6]), i6.ansi[7] = p3(e5.white, t4.DEFAULT_ANSI_COLORS[7]), i6.ansi[8] = p3(e5.brightBlack, t4.DEFAULT_ANSI_COLORS[8]), i6.ansi[9] = p3(e5.brightRed, t4.DEFAULT_ANSI_COLORS[9]), i6.ansi[10] = p3(e5.brightGreen, t4.DEFAULT_ANSI_COLORS[10]), i6.ansi[11] = p3(e5.brightYellow, t4.DEFAULT_ANSI_COLORS[11]), i6.ansi[12] = p3(e5.brightBlue, t4.DEFAULT_ANSI_COLORS[12]), i6.ansi[13] = p3(e5.brightMagenta, t4.DEFAULT_ANSI_COLORS[13]), i6.ansi[14] = p3(e5.brightCyan, t4.DEFAULT_ANSI_COLORS[14]), i6.ansi[15] = p3(e5.brightWhite, t4.DEFAULT_ANSI_COLORS[15]), e5.extendedAnsi) {
              const s5 = Math.min(i6.ansi.length - 16, e5.extendedAnsi.length);
              for (let r4 = 0; r4 < s5; r4++) i6.ansi[r4 + 16] = p3(e5.extendedAnsi[r4], t4.DEFAULT_ANSI_COLORS[r4 + 16]);
            }
            this._contrastCache.clear(), this._halfContrastCache.clear(), this._updateRestoreColors(), this._onChangeColors.fire(this.colors);
          }
          restoreColor(e5) {
            this._restoreColor(e5), this._onChangeColors.fire(this.colors);
          }
          _restoreColor(e5) {
            if (void 0 !== e5) switch (e5) {
              case 256:
                this._colors.foreground = this._restoreColors.foreground;
                break;
              case 257:
                this._colors.background = this._restoreColors.background;
                break;
              case 258:
                this._colors.cursor = this._restoreColors.cursor;
                break;
              default:
                this._colors.ansi[e5] = this._restoreColors.ansi[e5];
            }
            else for (let e6 = 0; e6 < this._restoreColors.ansi.length; ++e6) this._colors.ansi[e6] = this._restoreColors.ansi[e6];
          }
          modifyColors(e5) {
            e5(this._colors), this._onChangeColors.fire(this.colors);
          }
          _updateRestoreColors() {
            this._restoreColors = { foreground: this._colors.foreground, background: this._colors.background, cursor: this._colors.cursor, ansi: this._colors.ansi.slice() };
          }
        };
        function p3(e5, t5) {
          if (void 0 !== e5) try {
            return o3.css.toColor(e5);
          } catch {
          }
          return t5;
        }
        t4.ThemeService = v3 = s4([r3(0, c3.IOptionsService)], v3);
      }, 6349: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CircularList = void 0;
        const s4 = i5(8460), r3 = i5(844);
        class n2 extends r3.Disposable {
          constructor(e5) {
            super(), this._maxLength = e5, this.onDeleteEmitter = this.register(new s4.EventEmitter()), this.onDelete = this.onDeleteEmitter.event, this.onInsertEmitter = this.register(new s4.EventEmitter()), this.onInsert = this.onInsertEmitter.event, this.onTrimEmitter = this.register(new s4.EventEmitter()), this.onTrim = this.onTrimEmitter.event, this._array = new Array(this._maxLength), this._startIndex = 0, this._length = 0;
          }
          get maxLength() {
            return this._maxLength;
          }
          set maxLength(e5) {
            if (this._maxLength === e5) return;
            const t5 = new Array(e5);
            for (let i6 = 0; i6 < Math.min(e5, this.length); i6++) t5[i6] = this._array[this._getCyclicIndex(i6)];
            this._array = t5, this._maxLength = e5, this._startIndex = 0;
          }
          get length() {
            return this._length;
          }
          set length(e5) {
            if (e5 > this._length) for (let t5 = this._length; t5 < e5; t5++) this._array[t5] = void 0;
            this._length = e5;
          }
          get(e5) {
            return this._array[this._getCyclicIndex(e5)];
          }
          set(e5, t5) {
            this._array[this._getCyclicIndex(e5)] = t5;
          }
          push(e5) {
            this._array[this._getCyclicIndex(this._length)] = e5, this._length === this._maxLength ? (this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1)) : this._length++;
          }
          recycle() {
            if (this._length !== this._maxLength) throw new Error("Can only recycle when the buffer is full");
            return this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1), this._array[this._getCyclicIndex(this._length - 1)];
          }
          get isFull() {
            return this._length === this._maxLength;
          }
          pop() {
            return this._array[this._getCyclicIndex(this._length-- - 1)];
          }
          splice(e5, t5, ...i6) {
            if (t5) {
              for (let i7 = e5; i7 < this._length - t5; i7++) this._array[this._getCyclicIndex(i7)] = this._array[this._getCyclicIndex(i7 + t5)];
              this._length -= t5, this.onDeleteEmitter.fire({ index: e5, amount: t5 });
            }
            for (let t6 = this._length - 1; t6 >= e5; t6--) this._array[this._getCyclicIndex(t6 + i6.length)] = this._array[this._getCyclicIndex(t6)];
            for (let t6 = 0; t6 < i6.length; t6++) this._array[this._getCyclicIndex(e5 + t6)] = i6[t6];
            if (i6.length && this.onInsertEmitter.fire({ index: e5, amount: i6.length }), this._length + i6.length > this._maxLength) {
              const e6 = this._length + i6.length - this._maxLength;
              this._startIndex += e6, this._length = this._maxLength, this.onTrimEmitter.fire(e6);
            } else this._length += i6.length;
          }
          trimStart(e5) {
            e5 > this._length && (e5 = this._length), this._startIndex += e5, this._length -= e5, this.onTrimEmitter.fire(e5);
          }
          shiftElements(e5, t5, i6) {
            if (!(t5 <= 0)) {
              if (e5 < 0 || e5 >= this._length) throw new Error("start argument out of range");
              if (e5 + i6 < 0) throw new Error("Cannot shift elements in list beyond index 0");
              if (i6 > 0) {
                for (let s6 = t5 - 1; s6 >= 0; s6--) this.set(e5 + s6 + i6, this.get(e5 + s6));
                const s5 = e5 + t5 + i6 - this._length;
                if (s5 > 0) for (this._length += s5; this._length > this._maxLength; ) this._length--, this._startIndex++, this.onTrimEmitter.fire(1);
              } else for (let s5 = 0; s5 < t5; s5++) this.set(e5 + s5 + i6, this.get(e5 + s5));
            }
          }
          _getCyclicIndex(e5) {
            return (this._startIndex + e5) % this._maxLength;
          }
        }
        t4.CircularList = n2;
      }, 1439: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.clone = void 0, t4.clone = function e5(t5, i5 = 5) {
          if ("object" != typeof t5) return t5;
          const s4 = Array.isArray(t5) ? [] : {};
          for (const r3 in t5) s4[r3] = i5 <= 1 ? t5[r3] : t5[r3] && e5(t5[r3], i5 - 1);
          return s4;
        };
      }, 8055: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.contrastRatio = t4.toPaddedHex = t4.rgba = t4.rgb = t4.css = t4.color = t4.channels = t4.NULL_COLOR = void 0;
        let i5 = 0, s4 = 0, r3 = 0, n2 = 0;
        var o3, a3, h3, c3, l3;
        function d3(e5) {
          const t5 = e5.toString(16);
          return t5.length < 2 ? "0" + t5 : t5;
        }
        function _2(e5, t5) {
          return e5 < t5 ? (t5 + 0.05) / (e5 + 0.05) : (e5 + 0.05) / (t5 + 0.05);
        }
        t4.NULL_COLOR = { css: "#00000000", rgba: 0 }, function(e5) {
          e5.toCss = function(e6, t5, i6, s5) {
            return void 0 !== s5 ? `#${d3(e6)}${d3(t5)}${d3(i6)}${d3(s5)}` : `#${d3(e6)}${d3(t5)}${d3(i6)}`;
          }, e5.toRgba = function(e6, t5, i6, s5 = 255) {
            return (e6 << 24 | t5 << 16 | i6 << 8 | s5) >>> 0;
          }, e5.toColor = function(t5, i6, s5, r4) {
            return { css: e5.toCss(t5, i6, s5, r4), rgba: e5.toRgba(t5, i6, s5, r4) };
          };
        }(o3 || (t4.channels = o3 = {})), function(e5) {
          function t5(e6, t6) {
            return n2 = Math.round(255 * t6), [i5, s4, r3] = l3.toChannels(e6.rgba), { css: o3.toCss(i5, s4, r3, n2), rgba: o3.toRgba(i5, s4, r3, n2) };
          }
          e5.blend = function(e6, t6) {
            if (n2 = (255 & t6.rgba) / 255, 1 === n2) return { css: t6.css, rgba: t6.rgba };
            const a4 = t6.rgba >> 24 & 255, h4 = t6.rgba >> 16 & 255, c4 = t6.rgba >> 8 & 255, l4 = e6.rgba >> 24 & 255, d4 = e6.rgba >> 16 & 255, _3 = e6.rgba >> 8 & 255;
            return i5 = l4 + Math.round((a4 - l4) * n2), s4 = d4 + Math.round((h4 - d4) * n2), r3 = _3 + Math.round((c4 - _3) * n2), { css: o3.toCss(i5, s4, r3), rgba: o3.toRgba(i5, s4, r3) };
          }, e5.isOpaque = function(e6) {
            return 255 == (255 & e6.rgba);
          }, e5.ensureContrastRatio = function(e6, t6, i6) {
            const s5 = l3.ensureContrastRatio(e6.rgba, t6.rgba, i6);
            if (s5) return o3.toColor(s5 >> 24 & 255, s5 >> 16 & 255, s5 >> 8 & 255);
          }, e5.opaque = function(e6) {
            const t6 = (255 | e6.rgba) >>> 0;
            return [i5, s4, r3] = l3.toChannels(t6), { css: o3.toCss(i5, s4, r3), rgba: t6 };
          }, e5.opacity = t5, e5.multiplyOpacity = function(e6, i6) {
            return n2 = 255 & e6.rgba, t5(e6, n2 * i6 / 255);
          }, e5.toColorRGB = function(e6) {
            return [e6.rgba >> 24 & 255, e6.rgba >> 16 & 255, e6.rgba >> 8 & 255];
          };
        }(a3 || (t4.color = a3 = {})), function(e5) {
          let t5, a4;
          try {
            const e6 = document.createElement("canvas");
            e6.width = 1, e6.height = 1;
            const i6 = e6.getContext("2d", { willReadFrequently: true });
            i6 && (t5 = i6, t5.globalCompositeOperation = "copy", a4 = t5.createLinearGradient(0, 0, 1, 1));
          } catch {
          }
          e5.toColor = function(e6) {
            if (e6.match(/#[\da-f]{3,8}/i)) switch (e6.length) {
              case 4:
                return i5 = parseInt(e6.slice(1, 2).repeat(2), 16), s4 = parseInt(e6.slice(2, 3).repeat(2), 16), r3 = parseInt(e6.slice(3, 4).repeat(2), 16), o3.toColor(i5, s4, r3);
              case 5:
                return i5 = parseInt(e6.slice(1, 2).repeat(2), 16), s4 = parseInt(e6.slice(2, 3).repeat(2), 16), r3 = parseInt(e6.slice(3, 4).repeat(2), 16), n2 = parseInt(e6.slice(4, 5).repeat(2), 16), o3.toColor(i5, s4, r3, n2);
              case 7:
                return { css: e6, rgba: (parseInt(e6.slice(1), 16) << 8 | 255) >>> 0 };
              case 9:
                return { css: e6, rgba: parseInt(e6.slice(1), 16) >>> 0 };
            }
            const h4 = e6.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);
            if (h4) return i5 = parseInt(h4[1]), s4 = parseInt(h4[2]), r3 = parseInt(h4[3]), n2 = Math.round(255 * (void 0 === h4[5] ? 1 : parseFloat(h4[5]))), o3.toColor(i5, s4, r3, n2);
            if (!t5 || !a4) throw new Error("css.toColor: Unsupported css format");
            if (t5.fillStyle = a4, t5.fillStyle = e6, "string" != typeof t5.fillStyle) throw new Error("css.toColor: Unsupported css format");
            if (t5.fillRect(0, 0, 1, 1), [i5, s4, r3, n2] = t5.getImageData(0, 0, 1, 1).data, 255 !== n2) throw new Error("css.toColor: Unsupported css format");
            return { rgba: o3.toRgba(i5, s4, r3, n2), css: e6 };
          };
        }(h3 || (t4.css = h3 = {})), function(e5) {
          function t5(e6, t6, i6) {
            const s5 = e6 / 255, r4 = t6 / 255, n3 = i6 / 255;
            return 0.2126 * (s5 <= 0.03928 ? s5 / 12.92 : Math.pow((s5 + 0.055) / 1.055, 2.4)) + 0.7152 * (r4 <= 0.03928 ? r4 / 12.92 : Math.pow((r4 + 0.055) / 1.055, 2.4)) + 0.0722 * (n3 <= 0.03928 ? n3 / 12.92 : Math.pow((n3 + 0.055) / 1.055, 2.4));
          }
          e5.relativeLuminance = function(e6) {
            return t5(e6 >> 16 & 255, e6 >> 8 & 255, 255 & e6);
          }, e5.relativeLuminance2 = t5;
        }(c3 || (t4.rgb = c3 = {})), function(e5) {
          function t5(e6, t6, i6) {
            const s5 = e6 >> 24 & 255, r4 = e6 >> 16 & 255, n3 = e6 >> 8 & 255;
            let o4 = t6 >> 24 & 255, a5 = t6 >> 16 & 255, h4 = t6 >> 8 & 255, l4 = _2(c3.relativeLuminance2(o4, a5, h4), c3.relativeLuminance2(s5, r4, n3));
            for (; l4 < i6 && (o4 > 0 || a5 > 0 || h4 > 0); ) o4 -= Math.max(0, Math.ceil(0.1 * o4)), a5 -= Math.max(0, Math.ceil(0.1 * a5)), h4 -= Math.max(0, Math.ceil(0.1 * h4)), l4 = _2(c3.relativeLuminance2(o4, a5, h4), c3.relativeLuminance2(s5, r4, n3));
            return (o4 << 24 | a5 << 16 | h4 << 8 | 255) >>> 0;
          }
          function a4(e6, t6, i6) {
            const s5 = e6 >> 24 & 255, r4 = e6 >> 16 & 255, n3 = e6 >> 8 & 255;
            let o4 = t6 >> 24 & 255, a5 = t6 >> 16 & 255, h4 = t6 >> 8 & 255, l4 = _2(c3.relativeLuminance2(o4, a5, h4), c3.relativeLuminance2(s5, r4, n3));
            for (; l4 < i6 && (o4 < 255 || a5 < 255 || h4 < 255); ) o4 = Math.min(255, o4 + Math.ceil(0.1 * (255 - o4))), a5 = Math.min(255, a5 + Math.ceil(0.1 * (255 - a5))), h4 = Math.min(255, h4 + Math.ceil(0.1 * (255 - h4))), l4 = _2(c3.relativeLuminance2(o4, a5, h4), c3.relativeLuminance2(s5, r4, n3));
            return (o4 << 24 | a5 << 16 | h4 << 8 | 255) >>> 0;
          }
          e5.blend = function(e6, t6) {
            if (n2 = (255 & t6) / 255, 1 === n2) return t6;
            const a5 = t6 >> 24 & 255, h4 = t6 >> 16 & 255, c4 = t6 >> 8 & 255, l4 = e6 >> 24 & 255, d4 = e6 >> 16 & 255, _3 = e6 >> 8 & 255;
            return i5 = l4 + Math.round((a5 - l4) * n2), s4 = d4 + Math.round((h4 - d4) * n2), r3 = _3 + Math.round((c4 - _3) * n2), o3.toRgba(i5, s4, r3);
          }, e5.ensureContrastRatio = function(e6, i6, s5) {
            const r4 = c3.relativeLuminance(e6 >> 8), n3 = c3.relativeLuminance(i6 >> 8);
            if (_2(r4, n3) < s5) {
              if (n3 < r4) {
                const n4 = t5(e6, i6, s5), o5 = _2(r4, c3.relativeLuminance(n4 >> 8));
                if (o5 < s5) {
                  const t6 = a4(e6, i6, s5);
                  return o5 > _2(r4, c3.relativeLuminance(t6 >> 8)) ? n4 : t6;
                }
                return n4;
              }
              const o4 = a4(e6, i6, s5), h4 = _2(r4, c3.relativeLuminance(o4 >> 8));
              if (h4 < s5) {
                const n4 = t5(e6, i6, s5);
                return h4 > _2(r4, c3.relativeLuminance(n4 >> 8)) ? o4 : n4;
              }
              return o4;
            }
          }, e5.reduceLuminance = t5, e5.increaseLuminance = a4, e5.toChannels = function(e6) {
            return [e6 >> 24 & 255, e6 >> 16 & 255, e6 >> 8 & 255, 255 & e6];
          };
        }(l3 || (t4.rgba = l3 = {})), t4.toPaddedHex = d3, t4.contrastRatio = _2;
      }, 8969: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CoreTerminal = void 0;
        const s4 = i5(844), r3 = i5(2585), n2 = i5(4348), o3 = i5(7866), a3 = i5(744), h3 = i5(7302), c3 = i5(6975), l3 = i5(8460), d3 = i5(1753), _2 = i5(1480), u4 = i5(7994), f4 = i5(9282), v3 = i5(5435), p3 = i5(5981), g2 = i5(2660);
        let m3 = false;
        class S2 extends s4.Disposable {
          get onScroll() {
            return this._onScrollApi || (this._onScrollApi = this.register(new l3.EventEmitter()), this._onScroll.event((e5) => {
              this._onScrollApi?.fire(e5.position);
            })), this._onScrollApi.event;
          }
          get cols() {
            return this._bufferService.cols;
          }
          get rows() {
            return this._bufferService.rows;
          }
          get buffers() {
            return this._bufferService.buffers;
          }
          get options() {
            return this.optionsService.options;
          }
          set options(e5) {
            for (const t5 in e5) this.optionsService.options[t5] = e5[t5];
          }
          constructor(e5) {
            super(), this._windowsWrappingHeuristics = this.register(new s4.MutableDisposable()), this._onBinary = this.register(new l3.EventEmitter()), this.onBinary = this._onBinary.event, this._onData = this.register(new l3.EventEmitter()), this.onData = this._onData.event, this._onLineFeed = this.register(new l3.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onResize = this.register(new l3.EventEmitter()), this.onResize = this._onResize.event, this._onWriteParsed = this.register(new l3.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event, this._onScroll = this.register(new l3.EventEmitter()), this._instantiationService = new n2.InstantiationService(), this.optionsService = this.register(new h3.OptionsService(e5)), this._instantiationService.setService(r3.IOptionsService, this.optionsService), this._bufferService = this.register(this._instantiationService.createInstance(a3.BufferService)), this._instantiationService.setService(r3.IBufferService, this._bufferService), this._logService = this.register(this._instantiationService.createInstance(o3.LogService)), this._instantiationService.setService(r3.ILogService, this._logService), this.coreService = this.register(this._instantiationService.createInstance(c3.CoreService)), this._instantiationService.setService(r3.ICoreService, this.coreService), this.coreMouseService = this.register(this._instantiationService.createInstance(d3.CoreMouseService)), this._instantiationService.setService(r3.ICoreMouseService, this.coreMouseService), this.unicodeService = this.register(this._instantiationService.createInstance(_2.UnicodeService)), this._instantiationService.setService(r3.IUnicodeService, this.unicodeService), this._charsetService = this._instantiationService.createInstance(u4.CharsetService), this._instantiationService.setService(r3.ICharsetService, this._charsetService), this._oscLinkService = this._instantiationService.createInstance(g2.OscLinkService), this._instantiationService.setService(r3.IOscLinkService, this._oscLinkService), this._inputHandler = this.register(new v3.InputHandler(this._bufferService, this._charsetService, this.coreService, this._logService, this.optionsService, this._oscLinkService, this.coreMouseService, this.unicodeService)), this.register((0, l3.forwardEvent)(this._inputHandler.onLineFeed, this._onLineFeed)), this.register(this._inputHandler), this.register((0, l3.forwardEvent)(this._bufferService.onResize, this._onResize)), this.register((0, l3.forwardEvent)(this.coreService.onData, this._onData)), this.register((0, l3.forwardEvent)(this.coreService.onBinary, this._onBinary)), this.register(this.coreService.onRequestScrollToBottom(() => this.scrollToBottom())), this.register(this.coreService.onUserInput(() => this._writeBuffer.handleUserInput())), this.register(this.optionsService.onMultipleOptionChange(["windowsMode", "windowsPty"], () => this._handleWindowsPtyOptionChange())), this.register(this._bufferService.onScroll((e6) => {
              this._onScroll.fire({ position: this._bufferService.buffer.ydisp, source: 0 }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
            })), this.register(this._inputHandler.onScroll((e6) => {
              this._onScroll.fire({ position: this._bufferService.buffer.ydisp, source: 0 }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
            })), this._writeBuffer = this.register(new p3.WriteBuffer((e6, t5) => this._inputHandler.parse(e6, t5))), this.register((0, l3.forwardEvent)(this._writeBuffer.onWriteParsed, this._onWriteParsed));
          }
          write(e5, t5) {
            this._writeBuffer.write(e5, t5);
          }
          writeSync(e5, t5) {
            this._logService.logLevel <= r3.LogLevelEnum.WARN && !m3 && (this._logService.warn("writeSync is unreliable and will be removed soon."), m3 = true), this._writeBuffer.writeSync(e5, t5);
          }
          input(e5, t5 = true) {
            this.coreService.triggerDataEvent(e5, t5);
          }
          resize(e5, t5) {
            isNaN(e5) || isNaN(t5) || (e5 = Math.max(e5, a3.MINIMUM_COLS), t5 = Math.max(t5, a3.MINIMUM_ROWS), this._bufferService.resize(e5, t5));
          }
          scroll(e5, t5 = false) {
            this._bufferService.scroll(e5, t5);
          }
          scrollLines(e5, t5, i6) {
            this._bufferService.scrollLines(e5, t5, i6);
          }
          scrollPages(e5) {
            this.scrollLines(e5 * (this.rows - 1));
          }
          scrollToTop() {
            this.scrollLines(-this._bufferService.buffer.ydisp);
          }
          scrollToBottom() {
            this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
          }
          scrollToLine(e5) {
            const t5 = e5 - this._bufferService.buffer.ydisp;
            0 !== t5 && this.scrollLines(t5);
          }
          registerEscHandler(e5, t5) {
            return this._inputHandler.registerEscHandler(e5, t5);
          }
          registerDcsHandler(e5, t5) {
            return this._inputHandler.registerDcsHandler(e5, t5);
          }
          registerCsiHandler(e5, t5) {
            return this._inputHandler.registerCsiHandler(e5, t5);
          }
          registerOscHandler(e5, t5) {
            return this._inputHandler.registerOscHandler(e5, t5);
          }
          _setup() {
            this._handleWindowsPtyOptionChange();
          }
          reset() {
            this._inputHandler.reset(), this._bufferService.reset(), this._charsetService.reset(), this.coreService.reset(), this.coreMouseService.reset();
          }
          _handleWindowsPtyOptionChange() {
            let e5 = false;
            const t5 = this.optionsService.rawOptions.windowsPty;
            t5 && void 0 !== t5.buildNumber && void 0 !== t5.buildNumber ? e5 = !!("conpty" === t5.backend && t5.buildNumber < 21376) : this.optionsService.rawOptions.windowsMode && (e5 = true), e5 ? this._enableWindowsWrappingHeuristics() : this._windowsWrappingHeuristics.clear();
          }
          _enableWindowsWrappingHeuristics() {
            if (!this._windowsWrappingHeuristics.value) {
              const e5 = [];
              e5.push(this.onLineFeed(f4.updateWindowsModeWrappedState.bind(null, this._bufferService))), e5.push(this.registerCsiHandler({ final: "H" }, () => ((0, f4.updateWindowsModeWrappedState)(this._bufferService), false))), this._windowsWrappingHeuristics.value = (0, s4.toDisposable)(() => {
                for (const t5 of e5) t5.dispose();
              });
            }
          }
        }
        t4.CoreTerminal = S2;
      }, 8460: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.runAndSubscribe = t4.forwardEvent = t4.EventEmitter = void 0, t4.EventEmitter = class {
          constructor() {
            this._listeners = [], this._disposed = false;
          }
          get event() {
            return this._event || (this._event = (e5) => (this._listeners.push(e5), { dispose: () => {
              if (!this._disposed) {
                for (let t5 = 0; t5 < this._listeners.length; t5++) if (this._listeners[t5] === e5) return void this._listeners.splice(t5, 1);
              }
            } })), this._event;
          }
          fire(e5, t5) {
            const i5 = [];
            for (let e6 = 0; e6 < this._listeners.length; e6++) i5.push(this._listeners[e6]);
            for (let s4 = 0; s4 < i5.length; s4++) i5[s4].call(void 0, e5, t5);
          }
          dispose() {
            this.clearListeners(), this._disposed = true;
          }
          clearListeners() {
            this._listeners && (this._listeners.length = 0);
          }
        }, t4.forwardEvent = function(e5, t5) {
          return e5((e6) => t5.fire(e6));
        }, t4.runAndSubscribe = function(e5, t5) {
          return t5(void 0), e5((e6) => t5(e6));
        };
      }, 5435: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.InputHandler = t4.WindowsOptionsReportType = void 0;
        const n2 = i5(2584), o3 = i5(7116), a3 = i5(2015), h3 = i5(844), c3 = i5(482), l3 = i5(8437), d3 = i5(8460), _2 = i5(643), u4 = i5(511), f4 = i5(3734), v3 = i5(2585), p3 = i5(1480), g2 = i5(6242), m3 = i5(6351), S2 = i5(5941), C3 = { "(": 0, ")": 1, "*": 2, "+": 3, "-": 1, ".": 2 }, b2 = 131072;
        function w3(e5, t5) {
          if (e5 > 24) return t5.setWinLines || false;
          switch (e5) {
            case 1:
              return !!t5.restoreWin;
            case 2:
              return !!t5.minimizeWin;
            case 3:
              return !!t5.setWinPosition;
            case 4:
              return !!t5.setWinSizePixels;
            case 5:
              return !!t5.raiseWin;
            case 6:
              return !!t5.lowerWin;
            case 7:
              return !!t5.refreshWin;
            case 8:
              return !!t5.setWinSizeChars;
            case 9:
              return !!t5.maximizeWin;
            case 10:
              return !!t5.fullscreenWin;
            case 11:
              return !!t5.getWinState;
            case 13:
              return !!t5.getWinPosition;
            case 14:
              return !!t5.getWinSizePixels;
            case 15:
              return !!t5.getScreenSizePixels;
            case 16:
              return !!t5.getCellSizePixels;
            case 18:
              return !!t5.getWinSizeChars;
            case 19:
              return !!t5.getScreenSizeChars;
            case 20:
              return !!t5.getIconTitle;
            case 21:
              return !!t5.getWinTitle;
            case 22:
              return !!t5.pushTitle;
            case 23:
              return !!t5.popTitle;
            case 24:
              return !!t5.setWinLines;
          }
          return false;
        }
        var y3;
        !function(e5) {
          e5[e5.GET_WIN_SIZE_PIXELS = 0] = "GET_WIN_SIZE_PIXELS", e5[e5.GET_CELL_SIZE_PIXELS = 1] = "GET_CELL_SIZE_PIXELS";
        }(y3 || (t4.WindowsOptionsReportType = y3 = {}));
        let E2 = 0;
        class k3 extends h3.Disposable {
          getAttrData() {
            return this._curAttrData;
          }
          constructor(e5, t5, i6, s5, r4, h4, _3, f5, v4 = new a3.EscapeSequenceParser()) {
            super(), this._bufferService = e5, this._charsetService = t5, this._coreService = i6, this._logService = s5, this._optionsService = r4, this._oscLinkService = h4, this._coreMouseService = _3, this._unicodeService = f5, this._parser = v4, this._parseBuffer = new Uint32Array(4096), this._stringDecoder = new c3.StringToUtf32(), this._utf8Decoder = new c3.Utf8ToUtf32(), this._workCell = new u4.CellData(), this._windowTitle = "", this._iconName = "", this._windowTitleStack = [], this._iconNameStack = [], this._curAttrData = l3.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l3.DEFAULT_ATTR_DATA.clone(), this._onRequestBell = this.register(new d3.EventEmitter()), this.onRequestBell = this._onRequestBell.event, this._onRequestRefreshRows = this.register(new d3.EventEmitter()), this.onRequestRefreshRows = this._onRequestRefreshRows.event, this._onRequestReset = this.register(new d3.EventEmitter()), this.onRequestReset = this._onRequestReset.event, this._onRequestSendFocus = this.register(new d3.EventEmitter()), this.onRequestSendFocus = this._onRequestSendFocus.event, this._onRequestSyncScrollBar = this.register(new d3.EventEmitter()), this.onRequestSyncScrollBar = this._onRequestSyncScrollBar.event, this._onRequestWindowsOptionsReport = this.register(new d3.EventEmitter()), this.onRequestWindowsOptionsReport = this._onRequestWindowsOptionsReport.event, this._onA11yChar = this.register(new d3.EventEmitter()), this.onA11yChar = this._onA11yChar.event, this._onA11yTab = this.register(new d3.EventEmitter()), this.onA11yTab = this._onA11yTab.event, this._onCursorMove = this.register(new d3.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onLineFeed = this.register(new d3.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onScroll = this.register(new d3.EventEmitter()), this.onScroll = this._onScroll.event, this._onTitleChange = this.register(new d3.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onColor = this.register(new d3.EventEmitter()), this.onColor = this._onColor.event, this._parseStack = { paused: false, cursorStartX: 0, cursorStartY: 0, decodedLength: 0, position: 0 }, this._specialColors = [256, 257, 258], this.register(this._parser), this._dirtyRowTracker = new L2(this._bufferService), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate((e6) => this._activeBuffer = e6.activeBuffer)), this._parser.setCsiHandlerFallback((e6, t6) => {
              this._logService.debug("Unknown CSI code: ", { identifier: this._parser.identToString(e6), params: t6.toArray() });
            }), this._parser.setEscHandlerFallback((e6) => {
              this._logService.debug("Unknown ESC code: ", { identifier: this._parser.identToString(e6) });
            }), this._parser.setExecuteHandlerFallback((e6) => {
              this._logService.debug("Unknown EXECUTE code: ", { code: e6 });
            }), this._parser.setOscHandlerFallback((e6, t6, i7) => {
              this._logService.debug("Unknown OSC code: ", { identifier: e6, action: t6, data: i7 });
            }), this._parser.setDcsHandlerFallback((e6, t6, i7) => {
              "HOOK" === t6 && (i7 = i7.toArray()), this._logService.debug("Unknown DCS code: ", { identifier: this._parser.identToString(e6), action: t6, payload: i7 });
            }), this._parser.setPrintHandler((e6, t6, i7) => this.print(e6, t6, i7)), this._parser.registerCsiHandler({ final: "@" }, (e6) => this.insertChars(e6)), this._parser.registerCsiHandler({ intermediates: " ", final: "@" }, (e6) => this.scrollLeft(e6)), this._parser.registerCsiHandler({ final: "A" }, (e6) => this.cursorUp(e6)), this._parser.registerCsiHandler({ intermediates: " ", final: "A" }, (e6) => this.scrollRight(e6)), this._parser.registerCsiHandler({ final: "B" }, (e6) => this.cursorDown(e6)), this._parser.registerCsiHandler({ final: "C" }, (e6) => this.cursorForward(e6)), this._parser.registerCsiHandler({ final: "D" }, (e6) => this.cursorBackward(e6)), this._parser.registerCsiHandler({ final: "E" }, (e6) => this.cursorNextLine(e6)), this._parser.registerCsiHandler({ final: "F" }, (e6) => this.cursorPrecedingLine(e6)), this._parser.registerCsiHandler({ final: "G" }, (e6) => this.cursorCharAbsolute(e6)), this._parser.registerCsiHandler({ final: "H" }, (e6) => this.cursorPosition(e6)), this._parser.registerCsiHandler({ final: "I" }, (e6) => this.cursorForwardTab(e6)), this._parser.registerCsiHandler({ final: "J" }, (e6) => this.eraseInDisplay(e6, false)), this._parser.registerCsiHandler({ prefix: "?", final: "J" }, (e6) => this.eraseInDisplay(e6, true)), this._parser.registerCsiHandler({ final: "K" }, (e6) => this.eraseInLine(e6, false)), this._parser.registerCsiHandler({ prefix: "?", final: "K" }, (e6) => this.eraseInLine(e6, true)), this._parser.registerCsiHandler({ final: "L" }, (e6) => this.insertLines(e6)), this._parser.registerCsiHandler({ final: "M" }, (e6) => this.deleteLines(e6)), this._parser.registerCsiHandler({ final: "P" }, (e6) => this.deleteChars(e6)), this._parser.registerCsiHandler({ final: "S" }, (e6) => this.scrollUp(e6)), this._parser.registerCsiHandler({ final: "T" }, (e6) => this.scrollDown(e6)), this._parser.registerCsiHandler({ final: "X" }, (e6) => this.eraseChars(e6)), this._parser.registerCsiHandler({ final: "Z" }, (e6) => this.cursorBackwardTab(e6)), this._parser.registerCsiHandler({ final: "`" }, (e6) => this.charPosAbsolute(e6)), this._parser.registerCsiHandler({ final: "a" }, (e6) => this.hPositionRelative(e6)), this._parser.registerCsiHandler({ final: "b" }, (e6) => this.repeatPrecedingCharacter(e6)), this._parser.registerCsiHandler({ final: "c" }, (e6) => this.sendDeviceAttributesPrimary(e6)), this._parser.registerCsiHandler({ prefix: ">", final: "c" }, (e6) => this.sendDeviceAttributesSecondary(e6)), this._parser.registerCsiHandler({ final: "d" }, (e6) => this.linePosAbsolute(e6)), this._parser.registerCsiHandler({ final: "e" }, (e6) => this.vPositionRelative(e6)), this._parser.registerCsiHandler({ final: "f" }, (e6) => this.hVPosition(e6)), this._parser.registerCsiHandler({ final: "g" }, (e6) => this.tabClear(e6)), this._parser.registerCsiHandler({ final: "h" }, (e6) => this.setMode(e6)), this._parser.registerCsiHandler({ prefix: "?", final: "h" }, (e6) => this.setModePrivate(e6)), this._parser.registerCsiHandler({ final: "l" }, (e6) => this.resetMode(e6)), this._parser.registerCsiHandler({ prefix: "?", final: "l" }, (e6) => this.resetModePrivate(e6)), this._parser.registerCsiHandler({ final: "m" }, (e6) => this.charAttributes(e6)), this._parser.registerCsiHandler({ final: "n" }, (e6) => this.deviceStatus(e6)), this._parser.registerCsiHandler({ prefix: "?", final: "n" }, (e6) => this.deviceStatusPrivate(e6)), this._parser.registerCsiHandler({ intermediates: "!", final: "p" }, (e6) => this.softReset(e6)), this._parser.registerCsiHandler({ intermediates: " ", final: "q" }, (e6) => this.setCursorStyle(e6)), this._parser.registerCsiHandler({ final: "r" }, (e6) => this.setScrollRegion(e6)), this._parser.registerCsiHandler({ final: "s" }, (e6) => this.saveCursor(e6)), this._parser.registerCsiHandler({ final: "t" }, (e6) => this.windowOptions(e6)), this._parser.registerCsiHandler({ final: "u" }, (e6) => this.restoreCursor(e6)), this._parser.registerCsiHandler({ intermediates: "'", final: "}" }, (e6) => this.insertColumns(e6)), this._parser.registerCsiHandler({ intermediates: "'", final: "~" }, (e6) => this.deleteColumns(e6)), this._parser.registerCsiHandler({ intermediates: '"', final: "q" }, (e6) => this.selectProtected(e6)), this._parser.registerCsiHandler({ intermediates: "$", final: "p" }, (e6) => this.requestMode(e6, true)), this._parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, (e6) => this.requestMode(e6, false)), this._parser.setExecuteHandler(n2.C0.BEL, () => this.bell()), this._parser.setExecuteHandler(n2.C0.LF, () => this.lineFeed()), this._parser.setExecuteHandler(n2.C0.VT, () => this.lineFeed()), this._parser.setExecuteHandler(n2.C0.FF, () => this.lineFeed()), this._parser.setExecuteHandler(n2.C0.CR, () => this.carriageReturn()), this._parser.setExecuteHandler(n2.C0.BS, () => this.backspace()), this._parser.setExecuteHandler(n2.C0.HT, () => this.tab()), this._parser.setExecuteHandler(n2.C0.SO, () => this.shiftOut()), this._parser.setExecuteHandler(n2.C0.SI, () => this.shiftIn()), this._parser.setExecuteHandler(n2.C1.IND, () => this.index()), this._parser.setExecuteHandler(n2.C1.NEL, () => this.nextLine()), this._parser.setExecuteHandler(n2.C1.HTS, () => this.tabSet()), this._parser.registerOscHandler(0, new g2.OscHandler((e6) => (this.setTitle(e6), this.setIconName(e6), true))), this._parser.registerOscHandler(1, new g2.OscHandler((e6) => this.setIconName(e6))), this._parser.registerOscHandler(2, new g2.OscHandler((e6) => this.setTitle(e6))), this._parser.registerOscHandler(4, new g2.OscHandler((e6) => this.setOrReportIndexedColor(e6))), this._parser.registerOscHandler(8, new g2.OscHandler((e6) => this.setHyperlink(e6))), this._parser.registerOscHandler(10, new g2.OscHandler((e6) => this.setOrReportFgColor(e6))), this._parser.registerOscHandler(11, new g2.OscHandler((e6) => this.setOrReportBgColor(e6))), this._parser.registerOscHandler(12, new g2.OscHandler((e6) => this.setOrReportCursorColor(e6))), this._parser.registerOscHandler(104, new g2.OscHandler((e6) => this.restoreIndexedColor(e6))), this._parser.registerOscHandler(110, new g2.OscHandler((e6) => this.restoreFgColor(e6))), this._parser.registerOscHandler(111, new g2.OscHandler((e6) => this.restoreBgColor(e6))), this._parser.registerOscHandler(112, new g2.OscHandler((e6) => this.restoreCursorColor(e6))), this._parser.registerEscHandler({ final: "7" }, () => this.saveCursor()), this._parser.registerEscHandler({ final: "8" }, () => this.restoreCursor()), this._parser.registerEscHandler({ final: "D" }, () => this.index()), this._parser.registerEscHandler({ final: "E" }, () => this.nextLine()), this._parser.registerEscHandler({ final: "H" }, () => this.tabSet()), this._parser.registerEscHandler({ final: "M" }, () => this.reverseIndex()), this._parser.registerEscHandler({ final: "=" }, () => this.keypadApplicationMode()), this._parser.registerEscHandler({ final: ">" }, () => this.keypadNumericMode()), this._parser.registerEscHandler({ final: "c" }, () => this.fullReset()), this._parser.registerEscHandler({ final: "n" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "o" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "|" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "}" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "~" }, () => this.setgLevel(1)), this._parser.registerEscHandler({ intermediates: "%", final: "@" }, () => this.selectDefaultCharset()), this._parser.registerEscHandler({ intermediates: "%", final: "G" }, () => this.selectDefaultCharset());
            for (const e6 in o3.CHARSETS) this._parser.registerEscHandler({ intermediates: "(", final: e6 }, () => this.selectCharset("(" + e6)), this._parser.registerEscHandler({ intermediates: ")", final: e6 }, () => this.selectCharset(")" + e6)), this._parser.registerEscHandler({ intermediates: "*", final: e6 }, () => this.selectCharset("*" + e6)), this._parser.registerEscHandler({ intermediates: "+", final: e6 }, () => this.selectCharset("+" + e6)), this._parser.registerEscHandler({ intermediates: "-", final: e6 }, () => this.selectCharset("-" + e6)), this._parser.registerEscHandler({ intermediates: ".", final: e6 }, () => this.selectCharset("." + e6)), this._parser.registerEscHandler({ intermediates: "/", final: e6 }, () => this.selectCharset("/" + e6));
            this._parser.registerEscHandler({ intermediates: "#", final: "8" }, () => this.screenAlignmentPattern()), this._parser.setErrorHandler((e6) => (this._logService.error("Parsing error: ", e6), e6)), this._parser.registerDcsHandler({ intermediates: "$", final: "q" }, new m3.DcsHandler((e6, t6) => this.requestStatusString(e6, t6)));
          }
          _preserveStack(e5, t5, i6, s5) {
            this._parseStack.paused = true, this._parseStack.cursorStartX = e5, this._parseStack.cursorStartY = t5, this._parseStack.decodedLength = i6, this._parseStack.position = s5;
          }
          _logSlowResolvingAsync(e5) {
            this._logService.logLevel <= v3.LogLevelEnum.WARN && Promise.race([e5, new Promise((e6, t5) => setTimeout(() => t5("#SLOW_TIMEOUT"), 5e3))]).catch((e6) => {
              if ("#SLOW_TIMEOUT" !== e6) throw e6;
              console.warn("async parser handler taking longer than 5000 ms");
            });
          }
          _getCurrentLinkId() {
            return this._curAttrData.extended.urlId;
          }
          parse(e5, t5) {
            let i6, s5 = this._activeBuffer.x, r4 = this._activeBuffer.y, n3 = 0;
            const o4 = this._parseStack.paused;
            if (o4) {
              if (i6 = this._parser.parse(this._parseBuffer, this._parseStack.decodedLength, t5)) return this._logSlowResolvingAsync(i6), i6;
              s5 = this._parseStack.cursorStartX, r4 = this._parseStack.cursorStartY, this._parseStack.paused = false, e5.length > b2 && (n3 = this._parseStack.position + b2);
            }
            if (this._logService.logLevel <= v3.LogLevelEnum.DEBUG && this._logService.debug("parsing data" + ("string" == typeof e5 ? ` "${e5}"` : ` "${Array.prototype.map.call(e5, (e6) => String.fromCharCode(e6)).join("")}"`), "string" == typeof e5 ? e5.split("").map((e6) => e6.charCodeAt(0)) : e5), this._parseBuffer.length < e5.length && this._parseBuffer.length < b2 && (this._parseBuffer = new Uint32Array(Math.min(e5.length, b2))), o4 || this._dirtyRowTracker.clearRange(), e5.length > b2) for (let t6 = n3; t6 < e5.length; t6 += b2) {
              const n4 = t6 + b2 < e5.length ? t6 + b2 : e5.length, o5 = "string" == typeof e5 ? this._stringDecoder.decode(e5.substring(t6, n4), this._parseBuffer) : this._utf8Decoder.decode(e5.subarray(t6, n4), this._parseBuffer);
              if (i6 = this._parser.parse(this._parseBuffer, o5)) return this._preserveStack(s5, r4, o5, t6), this._logSlowResolvingAsync(i6), i6;
            }
            else if (!o4) {
              const t6 = "string" == typeof e5 ? this._stringDecoder.decode(e5, this._parseBuffer) : this._utf8Decoder.decode(e5, this._parseBuffer);
              if (i6 = this._parser.parse(this._parseBuffer, t6)) return this._preserveStack(s5, r4, t6, 0), this._logSlowResolvingAsync(i6), i6;
            }
            this._activeBuffer.x === s5 && this._activeBuffer.y === r4 || this._onCursorMove.fire();
            const a4 = this._dirtyRowTracker.end + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp), h4 = this._dirtyRowTracker.start + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
            h4 < this._bufferService.rows && this._onRequestRefreshRows.fire(Math.min(h4, this._bufferService.rows - 1), Math.min(a4, this._bufferService.rows - 1));
          }
          print(e5, t5, i6) {
            let s5, r4;
            const n3 = this._charsetService.charset, o4 = this._optionsService.rawOptions.screenReaderMode, a4 = this._bufferService.cols, h4 = this._coreService.decPrivateModes.wraparound, d4 = this._coreService.modes.insertMode, u5 = this._curAttrData;
            let f5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._activeBuffer.x && i6 - t5 > 0 && 2 === f5.getWidth(this._activeBuffer.x - 1) && f5.setCellFromCodepoint(this._activeBuffer.x - 1, 0, 1, u5);
            let v4 = this._parser.precedingJoinState;
            for (let g3 = t5; g3 < i6; ++g3) {
              if (s5 = e5[g3], s5 < 127 && n3) {
                const e6 = n3[String.fromCharCode(s5)];
                e6 && (s5 = e6.charCodeAt(0));
              }
              const t6 = this._unicodeService.charProperties(s5, v4);
              r4 = p3.UnicodeService.extractWidth(t6);
              const i7 = p3.UnicodeService.extractShouldJoin(t6), m4 = i7 ? p3.UnicodeService.extractWidth(v4) : 0;
              if (v4 = t6, o4 && this._onA11yChar.fire((0, c3.stringFromCodePoint)(s5)), this._getCurrentLinkId() && this._oscLinkService.addLineToLink(this._getCurrentLinkId(), this._activeBuffer.ybase + this._activeBuffer.y), this._activeBuffer.x + r4 - m4 > a4) {
                if (h4) {
                  const e6 = f5;
                  let t7 = this._activeBuffer.x - m4;
                  for (this._activeBuffer.x = m4, this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData(), true)) : (this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = true), f5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y), m4 > 0 && f5 instanceof l3.BufferLine && f5.copyCellsFrom(e6, t7, 0, m4, false); t7 < a4; ) e6.setCellFromCodepoint(t7++, 0, 1, u5);
                } else if (this._activeBuffer.x = a4 - 1, 2 === r4) continue;
              }
              if (i7 && this._activeBuffer.x) {
                const e6 = f5.getWidth(this._activeBuffer.x - 1) ? 1 : 2;
                f5.addCodepointToCell(this._activeBuffer.x - e6, s5, r4);
                for (let e7 = r4 - m4; --e7 >= 0; ) f5.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, u5);
              } else if (d4 && (f5.insertCells(this._activeBuffer.x, r4 - m4, this._activeBuffer.getNullCell(u5)), 2 === f5.getWidth(a4 - 1) && f5.setCellFromCodepoint(a4 - 1, _2.NULL_CELL_CODE, _2.NULL_CELL_WIDTH, u5)), f5.setCellFromCodepoint(this._activeBuffer.x++, s5, r4, u5), r4 > 0) for (; --r4; ) f5.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, u5);
            }
            this._parser.precedingJoinState = v4, this._activeBuffer.x < a4 && i6 - t5 > 0 && 0 === f5.getWidth(this._activeBuffer.x) && !f5.hasContent(this._activeBuffer.x) && f5.setCellFromCodepoint(this._activeBuffer.x, 0, 1, u5), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          registerCsiHandler(e5, t5) {
            return "t" !== e5.final || e5.prefix || e5.intermediates ? this._parser.registerCsiHandler(e5, t5) : this._parser.registerCsiHandler(e5, (e6) => !w3(e6.params[0], this._optionsService.rawOptions.windowOptions) || t5(e6));
          }
          registerDcsHandler(e5, t5) {
            return this._parser.registerDcsHandler(e5, new m3.DcsHandler(t5));
          }
          registerEscHandler(e5, t5) {
            return this._parser.registerEscHandler(e5, t5);
          }
          registerOscHandler(e5, t5) {
            return this._parser.registerOscHandler(e5, new g2.OscHandler(t5));
          }
          bell() {
            return this._onRequestBell.fire(), true;
          }
          lineFeed() {
            return this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._optionsService.rawOptions.convertEol && (this._activeBuffer.x = 0), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows ? this._activeBuffer.y = this._bufferService.rows - 1 : this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.x >= this._bufferService.cols && this._activeBuffer.x--, this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._onLineFeed.fire(), true;
          }
          carriageReturn() {
            return this._activeBuffer.x = 0, true;
          }
          backspace() {
            if (!this._coreService.decPrivateModes.reverseWraparound) return this._restrictCursor(), this._activeBuffer.x > 0 && this._activeBuffer.x--, true;
            if (this._restrictCursor(this._bufferService.cols), this._activeBuffer.x > 0) this._activeBuffer.x--;
            else if (0 === this._activeBuffer.x && this._activeBuffer.y > this._activeBuffer.scrollTop && this._activeBuffer.y <= this._activeBuffer.scrollBottom && this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)?.isWrapped) {
              this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.y--, this._activeBuffer.x = this._bufferService.cols - 1;
              const e5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
              e5.hasWidth(this._activeBuffer.x) && !e5.hasContent(this._activeBuffer.x) && this._activeBuffer.x--;
            }
            return this._restrictCursor(), true;
          }
          tab() {
            if (this._activeBuffer.x >= this._bufferService.cols) return true;
            const e5 = this._activeBuffer.x;
            return this._activeBuffer.x = this._activeBuffer.nextStop(), this._optionsService.rawOptions.screenReaderMode && this._onA11yTab.fire(this._activeBuffer.x - e5), true;
          }
          shiftOut() {
            return this._charsetService.setgLevel(1), true;
          }
          shiftIn() {
            return this._charsetService.setgLevel(0), true;
          }
          _restrictCursor(e5 = this._bufferService.cols - 1) {
            this._activeBuffer.x = Math.min(e5, Math.max(0, this._activeBuffer.x)), this._activeBuffer.y = this._coreService.decPrivateModes.origin ? Math.min(this._activeBuffer.scrollBottom, Math.max(this._activeBuffer.scrollTop, this._activeBuffer.y)) : Math.min(this._bufferService.rows - 1, Math.max(0, this._activeBuffer.y)), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          _setCursor(e5, t5) {
            this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._coreService.decPrivateModes.origin ? (this._activeBuffer.x = e5, this._activeBuffer.y = this._activeBuffer.scrollTop + t5) : (this._activeBuffer.x = e5, this._activeBuffer.y = t5), this._restrictCursor(), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          _moveCursor(e5, t5) {
            this._restrictCursor(), this._setCursor(this._activeBuffer.x + e5, this._activeBuffer.y + t5);
          }
          cursorUp(e5) {
            const t5 = this._activeBuffer.y - this._activeBuffer.scrollTop;
            return t5 >= 0 ? this._moveCursor(0, -Math.min(t5, e5.params[0] || 1)) : this._moveCursor(0, -(e5.params[0] || 1)), true;
          }
          cursorDown(e5) {
            const t5 = this._activeBuffer.scrollBottom - this._activeBuffer.y;
            return t5 >= 0 ? this._moveCursor(0, Math.min(t5, e5.params[0] || 1)) : this._moveCursor(0, e5.params[0] || 1), true;
          }
          cursorForward(e5) {
            return this._moveCursor(e5.params[0] || 1, 0), true;
          }
          cursorBackward(e5) {
            return this._moveCursor(-(e5.params[0] || 1), 0), true;
          }
          cursorNextLine(e5) {
            return this.cursorDown(e5), this._activeBuffer.x = 0, true;
          }
          cursorPrecedingLine(e5) {
            return this.cursorUp(e5), this._activeBuffer.x = 0, true;
          }
          cursorCharAbsolute(e5) {
            return this._setCursor((e5.params[0] || 1) - 1, this._activeBuffer.y), true;
          }
          cursorPosition(e5) {
            return this._setCursor(e5.length >= 2 ? (e5.params[1] || 1) - 1 : 0, (e5.params[0] || 1) - 1), true;
          }
          charPosAbsolute(e5) {
            return this._setCursor((e5.params[0] || 1) - 1, this._activeBuffer.y), true;
          }
          hPositionRelative(e5) {
            return this._moveCursor(e5.params[0] || 1, 0), true;
          }
          linePosAbsolute(e5) {
            return this._setCursor(this._activeBuffer.x, (e5.params[0] || 1) - 1), true;
          }
          vPositionRelative(e5) {
            return this._moveCursor(0, e5.params[0] || 1), true;
          }
          hVPosition(e5) {
            return this.cursorPosition(e5), true;
          }
          tabClear(e5) {
            const t5 = e5.params[0];
            return 0 === t5 ? delete this._activeBuffer.tabs[this._activeBuffer.x] : 3 === t5 && (this._activeBuffer.tabs = {}), true;
          }
          cursorForwardTab(e5) {
            if (this._activeBuffer.x >= this._bufferService.cols) return true;
            let t5 = e5.params[0] || 1;
            for (; t5--; ) this._activeBuffer.x = this._activeBuffer.nextStop();
            return true;
          }
          cursorBackwardTab(e5) {
            if (this._activeBuffer.x >= this._bufferService.cols) return true;
            let t5 = e5.params[0] || 1;
            for (; t5--; ) this._activeBuffer.x = this._activeBuffer.prevStop();
            return true;
          }
          selectProtected(e5) {
            const t5 = e5.params[0];
            return 1 === t5 && (this._curAttrData.bg |= 536870912), 2 !== t5 && 0 !== t5 || (this._curAttrData.bg &= -536870913), true;
          }
          _eraseInBufferLine(e5, t5, i6, s5 = false, r4 = false) {
            const n3 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e5);
            n3.replaceCells(t5, i6, this._activeBuffer.getNullCell(this._eraseAttrData()), r4), s5 && (n3.isWrapped = false);
          }
          _resetBufferLine(e5, t5 = false) {
            const i6 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e5);
            i6 && (i6.fill(this._activeBuffer.getNullCell(this._eraseAttrData()), t5), this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase + e5), i6.isWrapped = false);
          }
          eraseInDisplay(e5, t5 = false) {
            let i6;
            switch (this._restrictCursor(this._bufferService.cols), e5.params[0]) {
              case 0:
                for (i6 = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i6), this._eraseInBufferLine(i6++, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t5); i6 < this._bufferService.rows; i6++) this._resetBufferLine(i6, t5);
                this._dirtyRowTracker.markDirty(i6);
                break;
              case 1:
                for (i6 = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i6), this._eraseInBufferLine(i6, 0, this._activeBuffer.x + 1, true, t5), this._activeBuffer.x + 1 >= this._bufferService.cols && (this._activeBuffer.lines.get(i6 + 1).isWrapped = false); i6--; ) this._resetBufferLine(i6, t5);
                this._dirtyRowTracker.markDirty(0);
                break;
              case 2:
                for (i6 = this._bufferService.rows, this._dirtyRowTracker.markDirty(i6 - 1); i6--; ) this._resetBufferLine(i6, t5);
                this._dirtyRowTracker.markDirty(0);
                break;
              case 3:
                const e6 = this._activeBuffer.lines.length - this._bufferService.rows;
                e6 > 0 && (this._activeBuffer.lines.trimStart(e6), this._activeBuffer.ybase = Math.max(this._activeBuffer.ybase - e6, 0), this._activeBuffer.ydisp = Math.max(this._activeBuffer.ydisp - e6, 0), this._onScroll.fire(0));
            }
            return true;
          }
          eraseInLine(e5, t5 = false) {
            switch (this._restrictCursor(this._bufferService.cols), e5.params[0]) {
              case 0:
                this._eraseInBufferLine(this._activeBuffer.y, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t5);
                break;
              case 1:
                this._eraseInBufferLine(this._activeBuffer.y, 0, this._activeBuffer.x + 1, false, t5);
                break;
              case 2:
                this._eraseInBufferLine(this._activeBuffer.y, 0, this._bufferService.cols, true, t5);
            }
            return this._dirtyRowTracker.markDirty(this._activeBuffer.y), true;
          }
          insertLines(e5) {
            this._restrictCursor();
            let t5 = e5.params[0] || 1;
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const i6 = this._activeBuffer.ybase + this._activeBuffer.y, s5 = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, r4 = this._bufferService.rows - 1 + this._activeBuffer.ybase - s5 + 1;
            for (; t5--; ) this._activeBuffer.lines.splice(r4 - 1, 1), this._activeBuffer.lines.splice(i6, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
          }
          deleteLines(e5) {
            this._restrictCursor();
            let t5 = e5.params[0] || 1;
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const i6 = this._activeBuffer.ybase + this._activeBuffer.y;
            let s5;
            for (s5 = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, s5 = this._bufferService.rows - 1 + this._activeBuffer.ybase - s5; t5--; ) this._activeBuffer.lines.splice(i6, 1), this._activeBuffer.lines.splice(s5, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
          }
          insertChars(e5) {
            this._restrictCursor();
            const t5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t5 && (t5.insertCells(this._activeBuffer.x, e5.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          deleteChars(e5) {
            this._restrictCursor();
            const t5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t5 && (t5.deleteCells(this._activeBuffer.x, e5.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          scrollUp(e5) {
            let t5 = e5.params[0] || 1;
            for (; t5--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollDown(e5) {
            let t5 = e5.params[0] || 1;
            for (; t5--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 0, this._activeBuffer.getBlankLine(l3.DEFAULT_ATTR_DATA));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollLeft(e5) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t5 = e5.params[0] || 1;
            for (let e6 = this._activeBuffer.scrollTop; e6 <= this._activeBuffer.scrollBottom; ++e6) {
              const i6 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e6);
              i6.deleteCells(0, t5, this._activeBuffer.getNullCell(this._eraseAttrData())), i6.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollRight(e5) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t5 = e5.params[0] || 1;
            for (let e6 = this._activeBuffer.scrollTop; e6 <= this._activeBuffer.scrollBottom; ++e6) {
              const i6 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e6);
              i6.insertCells(0, t5, this._activeBuffer.getNullCell(this._eraseAttrData())), i6.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          insertColumns(e5) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t5 = e5.params[0] || 1;
            for (let e6 = this._activeBuffer.scrollTop; e6 <= this._activeBuffer.scrollBottom; ++e6) {
              const i6 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e6);
              i6.insertCells(this._activeBuffer.x, t5, this._activeBuffer.getNullCell(this._eraseAttrData())), i6.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          deleteColumns(e5) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t5 = e5.params[0] || 1;
            for (let e6 = this._activeBuffer.scrollTop; e6 <= this._activeBuffer.scrollBottom; ++e6) {
              const i6 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e6);
              i6.deleteCells(this._activeBuffer.x, t5, this._activeBuffer.getNullCell(this._eraseAttrData())), i6.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          eraseChars(e5) {
            this._restrictCursor();
            const t5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t5 && (t5.replaceCells(this._activeBuffer.x, this._activeBuffer.x + (e5.params[0] || 1), this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          repeatPrecedingCharacter(e5) {
            const t5 = this._parser.precedingJoinState;
            if (!t5) return true;
            const i6 = e5.params[0] || 1, s5 = p3.UnicodeService.extractWidth(t5), r4 = this._activeBuffer.x - s5, n3 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).getString(r4), o4 = new Uint32Array(n3.length * i6);
            let a4 = 0;
            for (let e6 = 0; e6 < n3.length; ) {
              const t6 = n3.codePointAt(e6) || 0;
              o4[a4++] = t6, e6 += t6 > 65535 ? 2 : 1;
            }
            let h4 = a4;
            for (let e6 = 1; e6 < i6; ++e6) o4.copyWithin(h4, 0, a4), h4 += a4;
            return this.print(o4, 0, h4), true;
          }
          sendDeviceAttributesPrimary(e5) {
            return e5.params[0] > 0 || (this._is("xterm") || this._is("rxvt-unicode") || this._is("screen") ? this._coreService.triggerDataEvent(n2.C0.ESC + "[?1;2c") : this._is("linux") && this._coreService.triggerDataEvent(n2.C0.ESC + "[?6c")), true;
          }
          sendDeviceAttributesSecondary(e5) {
            return e5.params[0] > 0 || (this._is("xterm") ? this._coreService.triggerDataEvent(n2.C0.ESC + "[>0;276;0c") : this._is("rxvt-unicode") ? this._coreService.triggerDataEvent(n2.C0.ESC + "[>85;95;0c") : this._is("linux") ? this._coreService.triggerDataEvent(e5.params[0] + "c") : this._is("screen") && this._coreService.triggerDataEvent(n2.C0.ESC + "[>83;40003;0c")), true;
          }
          _is(e5) {
            return 0 === (this._optionsService.rawOptions.termName + "").indexOf(e5);
          }
          setMode(e5) {
            for (let t5 = 0; t5 < e5.length; t5++) switch (e5.params[t5]) {
              case 4:
                this._coreService.modes.insertMode = true;
                break;
              case 20:
                this._optionsService.options.convertEol = true;
            }
            return true;
          }
          setModePrivate(e5) {
            for (let t5 = 0; t5 < e5.length; t5++) switch (e5.params[t5]) {
              case 1:
                this._coreService.decPrivateModes.applicationCursorKeys = true;
                break;
              case 2:
                this._charsetService.setgCharset(0, o3.DEFAULT_CHARSET), this._charsetService.setgCharset(1, o3.DEFAULT_CHARSET), this._charsetService.setgCharset(2, o3.DEFAULT_CHARSET), this._charsetService.setgCharset(3, o3.DEFAULT_CHARSET);
                break;
              case 3:
                this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(132, this._bufferService.rows), this._onRequestReset.fire());
                break;
              case 6:
                this._coreService.decPrivateModes.origin = true, this._setCursor(0, 0);
                break;
              case 7:
                this._coreService.decPrivateModes.wraparound = true;
                break;
              case 12:
                this._optionsService.options.cursorBlink = true;
                break;
              case 45:
                this._coreService.decPrivateModes.reverseWraparound = true;
                break;
              case 66:
                this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire();
                break;
              case 9:
                this._coreMouseService.activeProtocol = "X10";
                break;
              case 1e3:
                this._coreMouseService.activeProtocol = "VT200";
                break;
              case 1002:
                this._coreMouseService.activeProtocol = "DRAG";
                break;
              case 1003:
                this._coreMouseService.activeProtocol = "ANY";
                break;
              case 1004:
                this._coreService.decPrivateModes.sendFocus = true, this._onRequestSendFocus.fire();
                break;
              case 1005:
                this._logService.debug("DECSET 1005 not supported (see #2507)");
                break;
              case 1006:
                this._coreMouseService.activeEncoding = "SGR";
                break;
              case 1015:
                this._logService.debug("DECSET 1015 not supported (see #2507)");
                break;
              case 1016:
                this._coreMouseService.activeEncoding = "SGR_PIXELS";
                break;
              case 25:
                this._coreService.isCursorHidden = false;
                break;
              case 1048:
                this.saveCursor();
                break;
              case 1049:
                this.saveCursor();
              case 47:
              case 1047:
                this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
                break;
              case 2004:
                this._coreService.decPrivateModes.bracketedPasteMode = true;
            }
            return true;
          }
          resetMode(e5) {
            for (let t5 = 0; t5 < e5.length; t5++) switch (e5.params[t5]) {
              case 4:
                this._coreService.modes.insertMode = false;
                break;
              case 20:
                this._optionsService.options.convertEol = false;
            }
            return true;
          }
          resetModePrivate(e5) {
            for (let t5 = 0; t5 < e5.length; t5++) switch (e5.params[t5]) {
              case 1:
                this._coreService.decPrivateModes.applicationCursorKeys = false;
                break;
              case 3:
                this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(80, this._bufferService.rows), this._onRequestReset.fire());
                break;
              case 6:
                this._coreService.decPrivateModes.origin = false, this._setCursor(0, 0);
                break;
              case 7:
                this._coreService.decPrivateModes.wraparound = false;
                break;
              case 12:
                this._optionsService.options.cursorBlink = false;
                break;
              case 45:
                this._coreService.decPrivateModes.reverseWraparound = false;
                break;
              case 66:
                this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire();
                break;
              case 9:
              case 1e3:
              case 1002:
              case 1003:
                this._coreMouseService.activeProtocol = "NONE";
                break;
              case 1004:
                this._coreService.decPrivateModes.sendFocus = false;
                break;
              case 1005:
                this._logService.debug("DECRST 1005 not supported (see #2507)");
                break;
              case 1006:
              case 1016:
                this._coreMouseService.activeEncoding = "DEFAULT";
                break;
              case 1015:
                this._logService.debug("DECRST 1015 not supported (see #2507)");
                break;
              case 25:
                this._coreService.isCursorHidden = true;
                break;
              case 1048:
                this.restoreCursor();
                break;
              case 1049:
              case 47:
              case 1047:
                this._bufferService.buffers.activateNormalBuffer(), 1049 === e5.params[t5] && this.restoreCursor(), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
                break;
              case 2004:
                this._coreService.decPrivateModes.bracketedPasteMode = false;
            }
            return true;
          }
          requestMode(e5, t5) {
            const i6 = this._coreService.decPrivateModes, { activeProtocol: s5, activeEncoding: r4 } = this._coreMouseService, o4 = this._coreService, { buffers: a4, cols: h4 } = this._bufferService, { active: c4, alt: l4 } = a4, d4 = this._optionsService.rawOptions, _3 = (e6) => e6 ? 1 : 2, u5 = e5.params[0];
            return f5 = u5, v4 = t5 ? 2 === u5 ? 4 : 4 === u5 ? _3(o4.modes.insertMode) : 12 === u5 ? 3 : 20 === u5 ? _3(d4.convertEol) : 0 : 1 === u5 ? _3(i6.applicationCursorKeys) : 3 === u5 ? d4.windowOptions.setWinLines ? 80 === h4 ? 2 : 132 === h4 ? 1 : 0 : 0 : 6 === u5 ? _3(i6.origin) : 7 === u5 ? _3(i6.wraparound) : 8 === u5 ? 3 : 9 === u5 ? _3("X10" === s5) : 12 === u5 ? _3(d4.cursorBlink) : 25 === u5 ? _3(!o4.isCursorHidden) : 45 === u5 ? _3(i6.reverseWraparound) : 66 === u5 ? _3(i6.applicationKeypad) : 67 === u5 ? 4 : 1e3 === u5 ? _3("VT200" === s5) : 1002 === u5 ? _3("DRAG" === s5) : 1003 === u5 ? _3("ANY" === s5) : 1004 === u5 ? _3(i6.sendFocus) : 1005 === u5 ? 4 : 1006 === u5 ? _3("SGR" === r4) : 1015 === u5 ? 4 : 1016 === u5 ? _3("SGR_PIXELS" === r4) : 1048 === u5 ? 1 : 47 === u5 || 1047 === u5 || 1049 === u5 ? _3(c4 === l4) : 2004 === u5 ? _3(i6.bracketedPasteMode) : 0, o4.triggerDataEvent(`${n2.C0.ESC}[${t5 ? "" : "?"}${f5};${v4}$y`), true;
            var f5, v4;
          }
          _updateAttrColor(e5, t5, i6, s5, r4) {
            return 2 === t5 ? (e5 |= 50331648, e5 &= -16777216, e5 |= f4.AttributeData.fromColorRGB([i6, s5, r4])) : 5 === t5 && (e5 &= -50331904, e5 |= 33554432 | 255 & i6), e5;
          }
          _extractColor(e5, t5, i6) {
            const s5 = [0, 0, -1, 0, 0, 0];
            let r4 = 0, n3 = 0;
            do {
              if (s5[n3 + r4] = e5.params[t5 + n3], e5.hasSubParams(t5 + n3)) {
                const i7 = e5.getSubParams(t5 + n3);
                let o4 = 0;
                do {
                  5 === s5[1] && (r4 = 1), s5[n3 + o4 + 1 + r4] = i7[o4];
                } while (++o4 < i7.length && o4 + n3 + 1 + r4 < s5.length);
                break;
              }
              if (5 === s5[1] && n3 + r4 >= 2 || 2 === s5[1] && n3 + r4 >= 5) break;
              s5[1] && (r4 = 1);
            } while (++n3 + t5 < e5.length && n3 + r4 < s5.length);
            for (let e6 = 2; e6 < s5.length; ++e6) -1 === s5[e6] && (s5[e6] = 0);
            switch (s5[0]) {
              case 38:
                i6.fg = this._updateAttrColor(i6.fg, s5[1], s5[3], s5[4], s5[5]);
                break;
              case 48:
                i6.bg = this._updateAttrColor(i6.bg, s5[1], s5[3], s5[4], s5[5]);
                break;
              case 58:
                i6.extended = i6.extended.clone(), i6.extended.underlineColor = this._updateAttrColor(i6.extended.underlineColor, s5[1], s5[3], s5[4], s5[5]);
            }
            return n3;
          }
          _processUnderline(e5, t5) {
            t5.extended = t5.extended.clone(), (!~e5 || e5 > 5) && (e5 = 1), t5.extended.underlineStyle = e5, t5.fg |= 268435456, 0 === e5 && (t5.fg &= -268435457), t5.updateExtended();
          }
          _processSGR0(e5) {
            e5.fg = l3.DEFAULT_ATTR_DATA.fg, e5.bg = l3.DEFAULT_ATTR_DATA.bg, e5.extended = e5.extended.clone(), e5.extended.underlineStyle = 0, e5.extended.underlineColor &= -67108864, e5.updateExtended();
          }
          charAttributes(e5) {
            if (1 === e5.length && 0 === e5.params[0]) return this._processSGR0(this._curAttrData), true;
            const t5 = e5.length;
            let i6;
            const s5 = this._curAttrData;
            for (let r4 = 0; r4 < t5; r4++) i6 = e5.params[r4], i6 >= 30 && i6 <= 37 ? (s5.fg &= -50331904, s5.fg |= 16777216 | i6 - 30) : i6 >= 40 && i6 <= 47 ? (s5.bg &= -50331904, s5.bg |= 16777216 | i6 - 40) : i6 >= 90 && i6 <= 97 ? (s5.fg &= -50331904, s5.fg |= 16777224 | i6 - 90) : i6 >= 100 && i6 <= 107 ? (s5.bg &= -50331904, s5.bg |= 16777224 | i6 - 100) : 0 === i6 ? this._processSGR0(s5) : 1 === i6 ? s5.fg |= 134217728 : 3 === i6 ? s5.bg |= 67108864 : 4 === i6 ? (s5.fg |= 268435456, this._processUnderline(e5.hasSubParams(r4) ? e5.getSubParams(r4)[0] : 1, s5)) : 5 === i6 ? s5.fg |= 536870912 : 7 === i6 ? s5.fg |= 67108864 : 8 === i6 ? s5.fg |= 1073741824 : 9 === i6 ? s5.fg |= 2147483648 : 2 === i6 ? s5.bg |= 134217728 : 21 === i6 ? this._processUnderline(2, s5) : 22 === i6 ? (s5.fg &= -134217729, s5.bg &= -134217729) : 23 === i6 ? s5.bg &= -67108865 : 24 === i6 ? (s5.fg &= -268435457, this._processUnderline(0, s5)) : 25 === i6 ? s5.fg &= -536870913 : 27 === i6 ? s5.fg &= -67108865 : 28 === i6 ? s5.fg &= -1073741825 : 29 === i6 ? s5.fg &= 2147483647 : 39 === i6 ? (s5.fg &= -67108864, s5.fg |= 16777215 & l3.DEFAULT_ATTR_DATA.fg) : 49 === i6 ? (s5.bg &= -67108864, s5.bg |= 16777215 & l3.DEFAULT_ATTR_DATA.bg) : 38 === i6 || 48 === i6 || 58 === i6 ? r4 += this._extractColor(e5, r4, s5) : 53 === i6 ? s5.bg |= 1073741824 : 55 === i6 ? s5.bg &= -1073741825 : 59 === i6 ? (s5.extended = s5.extended.clone(), s5.extended.underlineColor = -1, s5.updateExtended()) : 100 === i6 ? (s5.fg &= -67108864, s5.fg |= 16777215 & l3.DEFAULT_ATTR_DATA.fg, s5.bg &= -67108864, s5.bg |= 16777215 & l3.DEFAULT_ATTR_DATA.bg) : this._logService.debug("Unknown SGR attribute: %d.", i6);
            return true;
          }
          deviceStatus(e5) {
            switch (e5.params[0]) {
              case 5:
                this._coreService.triggerDataEvent(`${n2.C0.ESC}[0n`);
                break;
              case 6:
                const e6 = this._activeBuffer.y + 1, t5 = this._activeBuffer.x + 1;
                this._coreService.triggerDataEvent(`${n2.C0.ESC}[${e6};${t5}R`);
            }
            return true;
          }
          deviceStatusPrivate(e5) {
            if (6 === e5.params[0]) {
              const e6 = this._activeBuffer.y + 1, t5 = this._activeBuffer.x + 1;
              this._coreService.triggerDataEvent(`${n2.C0.ESC}[?${e6};${t5}R`);
            }
            return true;
          }
          softReset(e5) {
            return this._coreService.isCursorHidden = false, this._onRequestSyncScrollBar.fire(), this._activeBuffer.scrollTop = 0, this._activeBuffer.scrollBottom = this._bufferService.rows - 1, this._curAttrData = l3.DEFAULT_ATTR_DATA.clone(), this._coreService.reset(), this._charsetService.reset(), this._activeBuffer.savedX = 0, this._activeBuffer.savedY = this._activeBuffer.ybase, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, this._coreService.decPrivateModes.origin = false, true;
          }
          setCursorStyle(e5) {
            const t5 = e5.params[0] || 1;
            switch (t5) {
              case 1:
              case 2:
                this._optionsService.options.cursorStyle = "block";
                break;
              case 3:
              case 4:
                this._optionsService.options.cursorStyle = "underline";
                break;
              case 5:
              case 6:
                this._optionsService.options.cursorStyle = "bar";
            }
            const i6 = t5 % 2 == 1;
            return this._optionsService.options.cursorBlink = i6, true;
          }
          setScrollRegion(e5) {
            const t5 = e5.params[0] || 1;
            let i6;
            return (e5.length < 2 || (i6 = e5.params[1]) > this._bufferService.rows || 0 === i6) && (i6 = this._bufferService.rows), i6 > t5 && (this._activeBuffer.scrollTop = t5 - 1, this._activeBuffer.scrollBottom = i6 - 1, this._setCursor(0, 0)), true;
          }
          windowOptions(e5) {
            if (!w3(e5.params[0], this._optionsService.rawOptions.windowOptions)) return true;
            const t5 = e5.length > 1 ? e5.params[1] : 0;
            switch (e5.params[0]) {
              case 14:
                2 !== t5 && this._onRequestWindowsOptionsReport.fire(y3.GET_WIN_SIZE_PIXELS);
                break;
              case 16:
                this._onRequestWindowsOptionsReport.fire(y3.GET_CELL_SIZE_PIXELS);
                break;
              case 18:
                this._bufferService && this._coreService.triggerDataEvent(`${n2.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);
                break;
              case 22:
                0 !== t5 && 2 !== t5 || (this._windowTitleStack.push(this._windowTitle), this._windowTitleStack.length > 10 && this._windowTitleStack.shift()), 0 !== t5 && 1 !== t5 || (this._iconNameStack.push(this._iconName), this._iconNameStack.length > 10 && this._iconNameStack.shift());
                break;
              case 23:
                0 !== t5 && 2 !== t5 || this._windowTitleStack.length && this.setTitle(this._windowTitleStack.pop()), 0 !== t5 && 1 !== t5 || this._iconNameStack.length && this.setIconName(this._iconNameStack.pop());
            }
            return true;
          }
          saveCursor(e5) {
            return this._activeBuffer.savedX = this._activeBuffer.x, this._activeBuffer.savedY = this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, true;
          }
          restoreCursor(e5) {
            return this._activeBuffer.x = this._activeBuffer.savedX || 0, this._activeBuffer.y = Math.max(this._activeBuffer.savedY - this._activeBuffer.ybase, 0), this._curAttrData.fg = this._activeBuffer.savedCurAttrData.fg, this._curAttrData.bg = this._activeBuffer.savedCurAttrData.bg, this._charsetService.charset = this._savedCharset, this._activeBuffer.savedCharset && (this._charsetService.charset = this._activeBuffer.savedCharset), this._restrictCursor(), true;
          }
          setTitle(e5) {
            return this._windowTitle = e5, this._onTitleChange.fire(e5), true;
          }
          setIconName(e5) {
            return this._iconName = e5, true;
          }
          setOrReportIndexedColor(e5) {
            const t5 = [], i6 = e5.split(";");
            for (; i6.length > 1; ) {
              const e6 = i6.shift(), s5 = i6.shift();
              if (/^\d+$/.exec(e6)) {
                const i7 = parseInt(e6);
                if (D3(i7)) if ("?" === s5) t5.push({ type: 0, index: i7 });
                else {
                  const e7 = (0, S2.parseColor)(s5);
                  e7 && t5.push({ type: 1, index: i7, color: e7 });
                }
              }
            }
            return t5.length && this._onColor.fire(t5), true;
          }
          setHyperlink(e5) {
            const t5 = e5.split(";");
            return !(t5.length < 2) && (t5[1] ? this._createHyperlink(t5[0], t5[1]) : !t5[0] && this._finishHyperlink());
          }
          _createHyperlink(e5, t5) {
            this._getCurrentLinkId() && this._finishHyperlink();
            const i6 = e5.split(":");
            let s5;
            const r4 = i6.findIndex((e6) => e6.startsWith("id="));
            return -1 !== r4 && (s5 = i6[r4].slice(3) || void 0), this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = this._oscLinkService.registerLink({ id: s5, uri: t5 }), this._curAttrData.updateExtended(), true;
          }
          _finishHyperlink() {
            return this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = 0, this._curAttrData.updateExtended(), true;
          }
          _setOrReportSpecialColor(e5, t5) {
            const i6 = e5.split(";");
            for (let e6 = 0; e6 < i6.length && !(t5 >= this._specialColors.length); ++e6, ++t5) if ("?" === i6[e6]) this._onColor.fire([{ type: 0, index: this._specialColors[t5] }]);
            else {
              const s5 = (0, S2.parseColor)(i6[e6]);
              s5 && this._onColor.fire([{ type: 1, index: this._specialColors[t5], color: s5 }]);
            }
            return true;
          }
          setOrReportFgColor(e5) {
            return this._setOrReportSpecialColor(e5, 0);
          }
          setOrReportBgColor(e5) {
            return this._setOrReportSpecialColor(e5, 1);
          }
          setOrReportCursorColor(e5) {
            return this._setOrReportSpecialColor(e5, 2);
          }
          restoreIndexedColor(e5) {
            if (!e5) return this._onColor.fire([{ type: 2 }]), true;
            const t5 = [], i6 = e5.split(";");
            for (let e6 = 0; e6 < i6.length; ++e6) if (/^\d+$/.exec(i6[e6])) {
              const s5 = parseInt(i6[e6]);
              D3(s5) && t5.push({ type: 2, index: s5 });
            }
            return t5.length && this._onColor.fire(t5), true;
          }
          restoreFgColor(e5) {
            return this._onColor.fire([{ type: 2, index: 256 }]), true;
          }
          restoreBgColor(e5) {
            return this._onColor.fire([{ type: 2, index: 257 }]), true;
          }
          restoreCursorColor(e5) {
            return this._onColor.fire([{ type: 2, index: 258 }]), true;
          }
          nextLine() {
            return this._activeBuffer.x = 0, this.index(), true;
          }
          keypadApplicationMode() {
            return this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire(), true;
          }
          keypadNumericMode() {
            return this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire(), true;
          }
          selectDefaultCharset() {
            return this._charsetService.setgLevel(0), this._charsetService.setgCharset(0, o3.DEFAULT_CHARSET), true;
          }
          selectCharset(e5) {
            return 2 !== e5.length ? (this.selectDefaultCharset(), true) : ("/" === e5[0] || this._charsetService.setgCharset(C3[e5[0]], o3.CHARSETS[e5[1]] || o3.DEFAULT_CHARSET), true);
          }
          index() {
            return this._restrictCursor(), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._restrictCursor(), true;
          }
          tabSet() {
            return this._activeBuffer.tabs[this._activeBuffer.x] = true, true;
          }
          reverseIndex() {
            if (this._restrictCursor(), this._activeBuffer.y === this._activeBuffer.scrollTop) {
              const e5 = this._activeBuffer.scrollBottom - this._activeBuffer.scrollTop;
              this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase + this._activeBuffer.y, e5, 1), this._activeBuffer.lines.set(this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.getBlankLine(this._eraseAttrData())), this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom);
            } else this._activeBuffer.y--, this._restrictCursor();
            return true;
          }
          fullReset() {
            return this._parser.reset(), this._onRequestReset.fire(), true;
          }
          reset() {
            this._curAttrData = l3.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l3.DEFAULT_ATTR_DATA.clone();
          }
          _eraseAttrData() {
            return this._eraseAttrDataInternal.bg &= -67108864, this._eraseAttrDataInternal.bg |= 67108863 & this._curAttrData.bg, this._eraseAttrDataInternal;
          }
          setgLevel(e5) {
            return this._charsetService.setgLevel(e5), true;
          }
          screenAlignmentPattern() {
            const e5 = new u4.CellData();
            e5.content = 1 << 22 | "E".charCodeAt(0), e5.fg = this._curAttrData.fg, e5.bg = this._curAttrData.bg, this._setCursor(0, 0);
            for (let t5 = 0; t5 < this._bufferService.rows; ++t5) {
              const i6 = this._activeBuffer.ybase + this._activeBuffer.y + t5, s5 = this._activeBuffer.lines.get(i6);
              s5 && (s5.fill(e5), s5.isWrapped = false);
            }
            return this._dirtyRowTracker.markAllDirty(), this._setCursor(0, 0), true;
          }
          requestStatusString(e5, t5) {
            const i6 = this._bufferService.buffer, s5 = this._optionsService.rawOptions;
            return ((e6) => (this._coreService.triggerDataEvent(`${n2.C0.ESC}${e6}${n2.C0.ESC}\\`), true))('"q' === e5 ? `P1$r${this._curAttrData.isProtected() ? 1 : 0}"q` : '"p' === e5 ? 'P1$r61;1"p' : "r" === e5 ? `P1$r${i6.scrollTop + 1};${i6.scrollBottom + 1}r` : "m" === e5 ? "P1$r0m" : " q" === e5 ? `P1$r${{ block: 2, underline: 4, bar: 6 }[s5.cursorStyle] - (s5.cursorBlink ? 1 : 0)} q` : "P0$r");
          }
          markRangeDirty(e5, t5) {
            this._dirtyRowTracker.markRangeDirty(e5, t5);
          }
        }
        t4.InputHandler = k3;
        let L2 = class {
          constructor(e5) {
            this._bufferService = e5, this.clearRange();
          }
          clearRange() {
            this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
          }
          markDirty(e5) {
            e5 < this.start ? this.start = e5 : e5 > this.end && (this.end = e5);
          }
          markRangeDirty(e5, t5) {
            e5 > t5 && (E2 = e5, e5 = t5, t5 = E2), e5 < this.start && (this.start = e5), t5 > this.end && (this.end = t5);
          }
          markAllDirty() {
            this.markRangeDirty(0, this._bufferService.rows - 1);
          }
        };
        function D3(e5) {
          return 0 <= e5 && e5 < 256;
        }
        L2 = s4([r3(0, v3.IBufferService)], L2);
      }, 844: (e4, t4) => {
        function i5(e5) {
          for (const t5 of e5) t5.dispose();
          e5.length = 0;
        }
        Object.defineProperty(t4, "__esModule", { value: true }), t4.getDisposeArrayDisposable = t4.disposeArray = t4.toDisposable = t4.MutableDisposable = t4.Disposable = void 0, t4.Disposable = class {
          constructor() {
            this._disposables = [], this._isDisposed = false;
          }
          dispose() {
            this._isDisposed = true;
            for (const e5 of this._disposables) e5.dispose();
            this._disposables.length = 0;
          }
          register(e5) {
            return this._disposables.push(e5), e5;
          }
          unregister(e5) {
            const t5 = this._disposables.indexOf(e5);
            -1 !== t5 && this._disposables.splice(t5, 1);
          }
        }, t4.MutableDisposable = class {
          constructor() {
            this._isDisposed = false;
          }
          get value() {
            return this._isDisposed ? void 0 : this._value;
          }
          set value(e5) {
            this._isDisposed || e5 === this._value || (this._value?.dispose(), this._value = e5);
          }
          clear() {
            this.value = void 0;
          }
          dispose() {
            this._isDisposed = true, this._value?.dispose(), this._value = void 0;
          }
        }, t4.toDisposable = function(e5) {
          return { dispose: e5 };
        }, t4.disposeArray = i5, t4.getDisposeArrayDisposable = function(e5) {
          return { dispose: () => i5(e5) };
        };
      }, 1505: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.FourKeyMap = t4.TwoKeyMap = void 0;
        class i5 {
          constructor() {
            this._data = {};
          }
          set(e5, t5, i6) {
            this._data[e5] || (this._data[e5] = {}), this._data[e5][t5] = i6;
          }
          get(e5, t5) {
            return this._data[e5] ? this._data[e5][t5] : void 0;
          }
          clear() {
            this._data = {};
          }
        }
        t4.TwoKeyMap = i5, t4.FourKeyMap = class {
          constructor() {
            this._data = new i5();
          }
          set(e5, t5, s4, r3, n2) {
            this._data.get(e5, t5) || this._data.set(e5, t5, new i5()), this._data.get(e5, t5).set(s4, r3, n2);
          }
          get(e5, t5, i6, s4) {
            return this._data.get(e5, t5)?.get(i6, s4);
          }
          clear() {
            this._data.clear();
          }
        };
      }, 6114: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.isChromeOS = t4.isLinux = t4.isWindows = t4.isIphone = t4.isIpad = t4.isMac = t4.getSafariVersion = t4.isSafari = t4.isLegacyEdge = t4.isFirefox = t4.isNode = void 0, t4.isNode = "undefined" != typeof process && "title" in process;
        const i5 = t4.isNode ? "node" : navigator.userAgent, s4 = t4.isNode ? "node" : navigator.platform;
        t4.isFirefox = i5.includes("Firefox"), t4.isLegacyEdge = i5.includes("Edge"), t4.isSafari = /^((?!chrome|android).)*safari/i.test(i5), t4.getSafariVersion = function() {
          if (!t4.isSafari) return 0;
          const e5 = i5.match(/Version\/(\d+)/);
          return null === e5 || e5.length < 2 ? 0 : parseInt(e5[1]);
        }, t4.isMac = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(s4), t4.isIpad = "iPad" === s4, t4.isIphone = "iPhone" === s4, t4.isWindows = ["Windows", "Win16", "Win32", "WinCE"].includes(s4), t4.isLinux = s4.indexOf("Linux") >= 0, t4.isChromeOS = /\bCrOS\b/.test(i5);
      }, 6106: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.SortedList = void 0;
        let i5 = 0;
        t4.SortedList = class {
          constructor(e5) {
            this._getKey = e5, this._array = [];
          }
          clear() {
            this._array.length = 0;
          }
          insert(e5) {
            0 !== this._array.length ? (i5 = this._search(this._getKey(e5)), this._array.splice(i5, 0, e5)) : this._array.push(e5);
          }
          delete(e5) {
            if (0 === this._array.length) return false;
            const t5 = this._getKey(e5);
            if (void 0 === t5) return false;
            if (i5 = this._search(t5), -1 === i5) return false;
            if (this._getKey(this._array[i5]) !== t5) return false;
            do {
              if (this._array[i5] === e5) return this._array.splice(i5, 1), true;
            } while (++i5 < this._array.length && this._getKey(this._array[i5]) === t5);
            return false;
          }
          *getKeyIterator(e5) {
            if (0 !== this._array.length && (i5 = this._search(e5), !(i5 < 0 || i5 >= this._array.length) && this._getKey(this._array[i5]) === e5)) do {
              yield this._array[i5];
            } while (++i5 < this._array.length && this._getKey(this._array[i5]) === e5);
          }
          forEachByKey(e5, t5) {
            if (0 !== this._array.length && (i5 = this._search(e5), !(i5 < 0 || i5 >= this._array.length) && this._getKey(this._array[i5]) === e5)) do {
              t5(this._array[i5]);
            } while (++i5 < this._array.length && this._getKey(this._array[i5]) === e5);
          }
          values() {
            return [...this._array].values();
          }
          _search(e5) {
            let t5 = 0, i6 = this._array.length - 1;
            for (; i6 >= t5; ) {
              let s4 = t5 + i6 >> 1;
              const r3 = this._getKey(this._array[s4]);
              if (r3 > e5) i6 = s4 - 1;
              else {
                if (!(r3 < e5)) {
                  for (; s4 > 0 && this._getKey(this._array[s4 - 1]) === e5; ) s4--;
                  return s4;
                }
                t5 = s4 + 1;
              }
            }
            return t5;
          }
        };
      }, 7226: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.DebouncedIdleTask = t4.IdleTaskQueue = t4.PriorityTaskQueue = void 0;
        const s4 = i5(6114);
        class r3 {
          constructor() {
            this._tasks = [], this._i = 0;
          }
          enqueue(e5) {
            this._tasks.push(e5), this._start();
          }
          flush() {
            for (; this._i < this._tasks.length; ) this._tasks[this._i]() || this._i++;
            this.clear();
          }
          clear() {
            this._idleCallback && (this._cancelCallback(this._idleCallback), this._idleCallback = void 0), this._i = 0, this._tasks.length = 0;
          }
          _start() {
            this._idleCallback || (this._idleCallback = this._requestCallback(this._process.bind(this)));
          }
          _process(e5) {
            this._idleCallback = void 0;
            let t5 = 0, i6 = 0, s5 = e5.timeRemaining(), r4 = 0;
            for (; this._i < this._tasks.length; ) {
              if (t5 = Date.now(), this._tasks[this._i]() || this._i++, t5 = Math.max(1, Date.now() - t5), i6 = Math.max(t5, i6), r4 = e5.timeRemaining(), 1.5 * i6 > r4) return s5 - t5 < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(s5 - t5))}ms`), void this._start();
              s5 = r4;
            }
            this.clear();
          }
        }
        class n2 extends r3 {
          _requestCallback(e5) {
            return setTimeout(() => e5(this._createDeadline(16)));
          }
          _cancelCallback(e5) {
            clearTimeout(e5);
          }
          _createDeadline(e5) {
            const t5 = Date.now() + e5;
            return { timeRemaining: () => Math.max(0, t5 - Date.now()) };
          }
        }
        t4.PriorityTaskQueue = n2, t4.IdleTaskQueue = !s4.isNode && "requestIdleCallback" in window ? class extends r3 {
          _requestCallback(e5) {
            return requestIdleCallback(e5);
          }
          _cancelCallback(e5) {
            cancelIdleCallback(e5);
          }
        } : n2, t4.DebouncedIdleTask = class {
          constructor() {
            this._queue = new t4.IdleTaskQueue();
          }
          set(e5) {
            this._queue.clear(), this._queue.enqueue(e5);
          }
          flush() {
            this._queue.flush();
          }
        };
      }, 9282: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.updateWindowsModeWrappedState = void 0;
        const s4 = i5(643);
        t4.updateWindowsModeWrappedState = function(e5) {
          const t5 = e5.buffer.lines.get(e5.buffer.ybase + e5.buffer.y - 1), i6 = t5?.get(e5.cols - 1), r3 = e5.buffer.lines.get(e5.buffer.ybase + e5.buffer.y);
          r3 && i6 && (r3.isWrapped = i6[s4.CHAR_DATA_CODE_INDEX] !== s4.NULL_CELL_CODE && i6[s4.CHAR_DATA_CODE_INDEX] !== s4.WHITESPACE_CELL_CODE);
        };
      }, 3734: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.ExtendedAttrs = t4.AttributeData = void 0;
        class i5 {
          constructor() {
            this.fg = 0, this.bg = 0, this.extended = new s4();
          }
          static toColorRGB(e5) {
            return [e5 >>> 16 & 255, e5 >>> 8 & 255, 255 & e5];
          }
          static fromColorRGB(e5) {
            return (255 & e5[0]) << 16 | (255 & e5[1]) << 8 | 255 & e5[2];
          }
          clone() {
            const e5 = new i5();
            return e5.fg = this.fg, e5.bg = this.bg, e5.extended = this.extended.clone(), e5;
          }
          isInverse() {
            return 67108864 & this.fg;
          }
          isBold() {
            return 134217728 & this.fg;
          }
          isUnderline() {
            return this.hasExtendedAttrs() && 0 !== this.extended.underlineStyle ? 1 : 268435456 & this.fg;
          }
          isBlink() {
            return 536870912 & this.fg;
          }
          isInvisible() {
            return 1073741824 & this.fg;
          }
          isItalic() {
            return 67108864 & this.bg;
          }
          isDim() {
            return 134217728 & this.bg;
          }
          isStrikethrough() {
            return 2147483648 & this.fg;
          }
          isProtected() {
            return 536870912 & this.bg;
          }
          isOverline() {
            return 1073741824 & this.bg;
          }
          getFgColorMode() {
            return 50331648 & this.fg;
          }
          getBgColorMode() {
            return 50331648 & this.bg;
          }
          isFgRGB() {
            return 50331648 == (50331648 & this.fg);
          }
          isBgRGB() {
            return 50331648 == (50331648 & this.bg);
          }
          isFgPalette() {
            return 16777216 == (50331648 & this.fg) || 33554432 == (50331648 & this.fg);
          }
          isBgPalette() {
            return 16777216 == (50331648 & this.bg) || 33554432 == (50331648 & this.bg);
          }
          isFgDefault() {
            return 0 == (50331648 & this.fg);
          }
          isBgDefault() {
            return 0 == (50331648 & this.bg);
          }
          isAttributeDefault() {
            return 0 === this.fg && 0 === this.bg;
          }
          getFgColor() {
            switch (50331648 & this.fg) {
              case 16777216:
              case 33554432:
                return 255 & this.fg;
              case 50331648:
                return 16777215 & this.fg;
              default:
                return -1;
            }
          }
          getBgColor() {
            switch (50331648 & this.bg) {
              case 16777216:
              case 33554432:
                return 255 & this.bg;
              case 50331648:
                return 16777215 & this.bg;
              default:
                return -1;
            }
          }
          hasExtendedAttrs() {
            return 268435456 & this.bg;
          }
          updateExtended() {
            this.extended.isEmpty() ? this.bg &= -268435457 : this.bg |= 268435456;
          }
          getUnderlineColor() {
            if (268435456 & this.bg && ~this.extended.underlineColor) switch (50331648 & this.extended.underlineColor) {
              case 16777216:
              case 33554432:
                return 255 & this.extended.underlineColor;
              case 50331648:
                return 16777215 & this.extended.underlineColor;
              default:
                return this.getFgColor();
            }
            return this.getFgColor();
          }
          getUnderlineColorMode() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 & this.extended.underlineColor : this.getFgColorMode();
          }
          isUnderlineColorRGB() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 == (50331648 & this.extended.underlineColor) : this.isFgRGB();
          }
          isUnderlineColorPalette() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 16777216 == (50331648 & this.extended.underlineColor) || 33554432 == (50331648 & this.extended.underlineColor) : this.isFgPalette();
          }
          isUnderlineColorDefault() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 0 == (50331648 & this.extended.underlineColor) : this.isFgDefault();
          }
          getUnderlineStyle() {
            return 268435456 & this.fg ? 268435456 & this.bg ? this.extended.underlineStyle : 1 : 0;
          }
          getUnderlineVariantOffset() {
            return this.extended.underlineVariantOffset;
          }
        }
        t4.AttributeData = i5;
        class s4 {
          get ext() {
            return this._urlId ? -469762049 & this._ext | this.underlineStyle << 26 : this._ext;
          }
          set ext(e5) {
            this._ext = e5;
          }
          get underlineStyle() {
            return this._urlId ? 5 : (469762048 & this._ext) >> 26;
          }
          set underlineStyle(e5) {
            this._ext &= -469762049, this._ext |= e5 << 26 & 469762048;
          }
          get underlineColor() {
            return 67108863 & this._ext;
          }
          set underlineColor(e5) {
            this._ext &= -67108864, this._ext |= 67108863 & e5;
          }
          get urlId() {
            return this._urlId;
          }
          set urlId(e5) {
            this._urlId = e5;
          }
          get underlineVariantOffset() {
            const e5 = (3758096384 & this._ext) >> 29;
            return e5 < 0 ? 4294967288 ^ e5 : e5;
          }
          set underlineVariantOffset(e5) {
            this._ext &= 536870911, this._ext |= e5 << 29 & 3758096384;
          }
          constructor(e5 = 0, t5 = 0) {
            this._ext = 0, this._urlId = 0, this._ext = e5, this._urlId = t5;
          }
          clone() {
            return new s4(this._ext, this._urlId);
          }
          isEmpty() {
            return 0 === this.underlineStyle && 0 === this._urlId;
          }
        }
        t4.ExtendedAttrs = s4;
      }, 9092: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.Buffer = t4.MAX_BUFFER_SIZE = void 0;
        const s4 = i5(6349), r3 = i5(7226), n2 = i5(3734), o3 = i5(8437), a3 = i5(4634), h3 = i5(511), c3 = i5(643), l3 = i5(4863), d3 = i5(7116);
        t4.MAX_BUFFER_SIZE = 4294967295, t4.Buffer = class {
          constructor(e5, t5, i6) {
            this._hasScrollback = e5, this._optionsService = t5, this._bufferService = i6, this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.tabs = {}, this.savedY = 0, this.savedX = 0, this.savedCurAttrData = o3.DEFAULT_ATTR_DATA.clone(), this.savedCharset = d3.DEFAULT_CHARSET, this.markers = [], this._nullCell = h3.CellData.fromCharData([0, c3.NULL_CELL_CHAR, c3.NULL_CELL_WIDTH, c3.NULL_CELL_CODE]), this._whitespaceCell = h3.CellData.fromCharData([0, c3.WHITESPACE_CELL_CHAR, c3.WHITESPACE_CELL_WIDTH, c3.WHITESPACE_CELL_CODE]), this._isClearing = false, this._memoryCleanupQueue = new r3.IdleTaskQueue(), this._memoryCleanupPosition = 0, this._cols = this._bufferService.cols, this._rows = this._bufferService.rows, this.lines = new s4.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
          }
          getNullCell(e5) {
            return e5 ? (this._nullCell.fg = e5.fg, this._nullCell.bg = e5.bg, this._nullCell.extended = e5.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new n2.ExtendedAttrs()), this._nullCell;
          }
          getWhitespaceCell(e5) {
            return e5 ? (this._whitespaceCell.fg = e5.fg, this._whitespaceCell.bg = e5.bg, this._whitespaceCell.extended = e5.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new n2.ExtendedAttrs()), this._whitespaceCell;
          }
          getBlankLine(e5, t5) {
            return new o3.BufferLine(this._bufferService.cols, this.getNullCell(e5), t5);
          }
          get hasScrollback() {
            return this._hasScrollback && this.lines.maxLength > this._rows;
          }
          get isCursorInViewport() {
            const e5 = this.ybase + this.y - this.ydisp;
            return e5 >= 0 && e5 < this._rows;
          }
          _getCorrectBufferLength(e5) {
            if (!this._hasScrollback) return e5;
            const i6 = e5 + this._optionsService.rawOptions.scrollback;
            return i6 > t4.MAX_BUFFER_SIZE ? t4.MAX_BUFFER_SIZE : i6;
          }
          fillViewportRows(e5) {
            if (0 === this.lines.length) {
              void 0 === e5 && (e5 = o3.DEFAULT_ATTR_DATA);
              let t5 = this._rows;
              for (; t5--; ) this.lines.push(this.getBlankLine(e5));
            }
          }
          clear() {
            this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new s4.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
          }
          resize(e5, t5) {
            const i6 = this.getNullCell(o3.DEFAULT_ATTR_DATA);
            let s5 = 0;
            const r4 = this._getCorrectBufferLength(t5);
            if (r4 > this.lines.maxLength && (this.lines.maxLength = r4), this.lines.length > 0) {
              if (this._cols < e5) for (let t6 = 0; t6 < this.lines.length; t6++) s5 += +this.lines.get(t6).resize(e5, i6);
              let n3 = 0;
              if (this._rows < t5) for (let s6 = this._rows; s6 < t5; s6++) this.lines.length < t5 + this.ybase && (this._optionsService.rawOptions.windowsMode || void 0 !== this._optionsService.rawOptions.windowsPty.backend || void 0 !== this._optionsService.rawOptions.windowsPty.buildNumber ? this.lines.push(new o3.BufferLine(e5, i6)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + n3 + 1 ? (this.ybase--, n3++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new o3.BufferLine(e5, i6)));
              else for (let e6 = this._rows; e6 > t5; e6--) this.lines.length > t5 + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
              if (r4 < this.lines.maxLength) {
                const e6 = this.lines.length - r4;
                e6 > 0 && (this.lines.trimStart(e6), this.ybase = Math.max(this.ybase - e6, 0), this.ydisp = Math.max(this.ydisp - e6, 0), this.savedY = Math.max(this.savedY - e6, 0)), this.lines.maxLength = r4;
              }
              this.x = Math.min(this.x, e5 - 1), this.y = Math.min(this.y, t5 - 1), n3 && (this.y += n3), this.savedX = Math.min(this.savedX, e5 - 1), this.scrollTop = 0;
            }
            if (this.scrollBottom = t5 - 1, this._isReflowEnabled && (this._reflow(e5, t5), this._cols > e5)) for (let t6 = 0; t6 < this.lines.length; t6++) s5 += +this.lines.get(t6).resize(e5, i6);
            this._cols = e5, this._rows = t5, this._memoryCleanupQueue.clear(), s5 > 0.1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue(() => this._batchedMemoryCleanup()));
          }
          _batchedMemoryCleanup() {
            let e5 = true;
            this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, e5 = false);
            let t5 = 0;
            for (; this._memoryCleanupPosition < this.lines.length; ) if (t5 += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), t5 > 100) return true;
            return e5;
          }
          get _isReflowEnabled() {
            const e5 = this._optionsService.rawOptions.windowsPty;
            return e5 && e5.buildNumber ? this._hasScrollback && "conpty" === e5.backend && e5.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
          }
          _reflow(e5, t5) {
            this._cols !== e5 && (e5 > this._cols ? this._reflowLarger(e5, t5) : this._reflowSmaller(e5, t5));
          }
          _reflowLarger(e5, t5) {
            const i6 = (0, a3.reflowLargerGetLinesToRemove)(this.lines, this._cols, e5, this.ybase + this.y, this.getNullCell(o3.DEFAULT_ATTR_DATA));
            if (i6.length > 0) {
              const s5 = (0, a3.reflowLargerCreateNewLayout)(this.lines, i6);
              (0, a3.reflowLargerApplyNewLayout)(this.lines, s5.layout), this._reflowLargerAdjustViewport(e5, t5, s5.countRemoved);
            }
          }
          _reflowLargerAdjustViewport(e5, t5, i6) {
            const s5 = this.getNullCell(o3.DEFAULT_ATTR_DATA);
            let r4 = i6;
            for (; r4-- > 0; ) 0 === this.ybase ? (this.y > 0 && this.y--, this.lines.length < t5 && this.lines.push(new o3.BufferLine(e5, s5))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
            this.savedY = Math.max(this.savedY - i6, 0);
          }
          _reflowSmaller(e5, t5) {
            const i6 = this.getNullCell(o3.DEFAULT_ATTR_DATA), s5 = [];
            let r4 = 0;
            for (let n3 = this.lines.length - 1; n3 >= 0; n3--) {
              let h4 = this.lines.get(n3);
              if (!h4 || !h4.isWrapped && h4.getTrimmedLength() <= e5) continue;
              const c4 = [h4];
              for (; h4.isWrapped && n3 > 0; ) h4 = this.lines.get(--n3), c4.unshift(h4);
              const l4 = this.ybase + this.y;
              if (l4 >= n3 && l4 < n3 + c4.length) continue;
              const d4 = c4[c4.length - 1].getTrimmedLength(), _2 = (0, a3.reflowSmallerGetNewLineLengths)(c4, this._cols, e5), u4 = _2.length - c4.length;
              let f4;
              f4 = 0 === this.ybase && this.y !== this.lines.length - 1 ? Math.max(0, this.y - this.lines.maxLength + u4) : Math.max(0, this.lines.length - this.lines.maxLength + u4);
              const v3 = [];
              for (let e6 = 0; e6 < u4; e6++) {
                const e7 = this.getBlankLine(o3.DEFAULT_ATTR_DATA, true);
                v3.push(e7);
              }
              v3.length > 0 && (s5.push({ start: n3 + c4.length + r4, newLines: v3 }), r4 += v3.length), c4.push(...v3);
              let p3 = _2.length - 1, g2 = _2[p3];
              0 === g2 && (p3--, g2 = _2[p3]);
              let m3 = c4.length - u4 - 1, S2 = d4;
              for (; m3 >= 0; ) {
                const e6 = Math.min(S2, g2);
                if (void 0 === c4[p3]) break;
                if (c4[p3].copyCellsFrom(c4[m3], S2 - e6, g2 - e6, e6, true), g2 -= e6, 0 === g2 && (p3--, g2 = _2[p3]), S2 -= e6, 0 === S2) {
                  m3--;
                  const e7 = Math.max(m3, 0);
                  S2 = (0, a3.getWrappedLineTrimmedLength)(c4, e7, this._cols);
                }
              }
              for (let t6 = 0; t6 < c4.length; t6++) _2[t6] < e5 && c4[t6].setCell(_2[t6], i6);
              let C3 = u4 - f4;
              for (; C3-- > 0; ) 0 === this.ybase ? this.y < t5 - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + r4) - t5 && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
              this.savedY = Math.min(this.savedY + u4, this.ybase + t5 - 1);
            }
            if (s5.length > 0) {
              const e6 = [], t6 = [];
              for (let e7 = 0; e7 < this.lines.length; e7++) t6.push(this.lines.get(e7));
              const i7 = this.lines.length;
              let n3 = i7 - 1, o4 = 0, a4 = s5[o4];
              this.lines.length = Math.min(this.lines.maxLength, this.lines.length + r4);
              let h4 = 0;
              for (let c5 = Math.min(this.lines.maxLength - 1, i7 + r4 - 1); c5 >= 0; c5--) if (a4 && a4.start > n3 + h4) {
                for (let e7 = a4.newLines.length - 1; e7 >= 0; e7--) this.lines.set(c5--, a4.newLines[e7]);
                c5++, e6.push({ index: n3 + 1, amount: a4.newLines.length }), h4 += a4.newLines.length, a4 = s5[++o4];
              } else this.lines.set(c5, t6[n3--]);
              let c4 = 0;
              for (let t7 = e6.length - 1; t7 >= 0; t7--) e6[t7].index += c4, this.lines.onInsertEmitter.fire(e6[t7]), c4 += e6[t7].amount;
              const l4 = Math.max(0, i7 + r4 - this.lines.maxLength);
              l4 > 0 && this.lines.onTrimEmitter.fire(l4);
            }
          }
          translateBufferLineToString(e5, t5, i6 = 0, s5) {
            const r4 = this.lines.get(e5);
            return r4 ? r4.translateToString(t5, i6, s5) : "";
          }
          getWrappedRangeForLine(e5) {
            let t5 = e5, i6 = e5;
            for (; t5 > 0 && this.lines.get(t5).isWrapped; ) t5--;
            for (; i6 + 1 < this.lines.length && this.lines.get(i6 + 1).isWrapped; ) i6++;
            return { first: t5, last: i6 };
          }
          setupTabStops(e5) {
            for (null != e5 ? this.tabs[e5] || (e5 = this.prevStop(e5)) : (this.tabs = {}, e5 = 0); e5 < this._cols; e5 += this._optionsService.rawOptions.tabStopWidth) this.tabs[e5] = true;
          }
          prevStop(e5) {
            for (null == e5 && (e5 = this.x); !this.tabs[--e5] && e5 > 0; ) ;
            return e5 >= this._cols ? this._cols - 1 : e5 < 0 ? 0 : e5;
          }
          nextStop(e5) {
            for (null == e5 && (e5 = this.x); !this.tabs[++e5] && e5 < this._cols; ) ;
            return e5 >= this._cols ? this._cols - 1 : e5 < 0 ? 0 : e5;
          }
          clearMarkers(e5) {
            this._isClearing = true;
            for (let t5 = 0; t5 < this.markers.length; t5++) this.markers[t5].line === e5 && (this.markers[t5].dispose(), this.markers.splice(t5--, 1));
            this._isClearing = false;
          }
          clearAllMarkers() {
            this._isClearing = true;
            for (let e5 = 0; e5 < this.markers.length; e5++) this.markers[e5].dispose(), this.markers.splice(e5--, 1);
            this._isClearing = false;
          }
          addMarker(e5) {
            const t5 = new l3.Marker(e5);
            return this.markers.push(t5), t5.register(this.lines.onTrim((e6) => {
              t5.line -= e6, t5.line < 0 && t5.dispose();
            })), t5.register(this.lines.onInsert((e6) => {
              t5.line >= e6.index && (t5.line += e6.amount);
            })), t5.register(this.lines.onDelete((e6) => {
              t5.line >= e6.index && t5.line < e6.index + e6.amount && t5.dispose(), t5.line > e6.index && (t5.line -= e6.amount);
            })), t5.register(t5.onDispose(() => this._removeMarker(t5))), t5;
          }
          _removeMarker(e5) {
            this._isClearing || this.markers.splice(this.markers.indexOf(e5), 1);
          }
        };
      }, 8437: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.BufferLine = t4.DEFAULT_ATTR_DATA = void 0;
        const s4 = i5(3734), r3 = i5(511), n2 = i5(643), o3 = i5(482);
        t4.DEFAULT_ATTR_DATA = Object.freeze(new s4.AttributeData());
        let a3 = 0;
        class h3 {
          constructor(e5, t5, i6 = false) {
            this.isWrapped = i6, this._combined = {}, this._extendedAttrs = {}, this._data = new Uint32Array(3 * e5);
            const s5 = t5 || r3.CellData.fromCharData([0, n2.NULL_CELL_CHAR, n2.NULL_CELL_WIDTH, n2.NULL_CELL_CODE]);
            for (let t6 = 0; t6 < e5; ++t6) this.setCell(t6, s5);
            this.length = e5;
          }
          get(e5) {
            const t5 = this._data[3 * e5 + 0], i6 = 2097151 & t5;
            return [this._data[3 * e5 + 1], 2097152 & t5 ? this._combined[e5] : i6 ? (0, o3.stringFromCodePoint)(i6) : "", t5 >> 22, 2097152 & t5 ? this._combined[e5].charCodeAt(this._combined[e5].length - 1) : i6];
          }
          set(e5, t5) {
            this._data[3 * e5 + 1] = t5[n2.CHAR_DATA_ATTR_INDEX], t5[n2.CHAR_DATA_CHAR_INDEX].length > 1 ? (this._combined[e5] = t5[1], this._data[3 * e5 + 0] = 2097152 | e5 | t5[n2.CHAR_DATA_WIDTH_INDEX] << 22) : this._data[3 * e5 + 0] = t5[n2.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | t5[n2.CHAR_DATA_WIDTH_INDEX] << 22;
          }
          getWidth(e5) {
            return this._data[3 * e5 + 0] >> 22;
          }
          hasWidth(e5) {
            return 12582912 & this._data[3 * e5 + 0];
          }
          getFg(e5) {
            return this._data[3 * e5 + 1];
          }
          getBg(e5) {
            return this._data[3 * e5 + 2];
          }
          hasContent(e5) {
            return 4194303 & this._data[3 * e5 + 0];
          }
          getCodePoint(e5) {
            const t5 = this._data[3 * e5 + 0];
            return 2097152 & t5 ? this._combined[e5].charCodeAt(this._combined[e5].length - 1) : 2097151 & t5;
          }
          isCombined(e5) {
            return 2097152 & this._data[3 * e5 + 0];
          }
          getString(e5) {
            const t5 = this._data[3 * e5 + 0];
            return 2097152 & t5 ? this._combined[e5] : 2097151 & t5 ? (0, o3.stringFromCodePoint)(2097151 & t5) : "";
          }
          isProtected(e5) {
            return 536870912 & this._data[3 * e5 + 2];
          }
          loadCell(e5, t5) {
            return a3 = 3 * e5, t5.content = this._data[a3 + 0], t5.fg = this._data[a3 + 1], t5.bg = this._data[a3 + 2], 2097152 & t5.content && (t5.combinedData = this._combined[e5]), 268435456 & t5.bg && (t5.extended = this._extendedAttrs[e5]), t5;
          }
          setCell(e5, t5) {
            2097152 & t5.content && (this._combined[e5] = t5.combinedData), 268435456 & t5.bg && (this._extendedAttrs[e5] = t5.extended), this._data[3 * e5 + 0] = t5.content, this._data[3 * e5 + 1] = t5.fg, this._data[3 * e5 + 2] = t5.bg;
          }
          setCellFromCodepoint(e5, t5, i6, s5) {
            268435456 & s5.bg && (this._extendedAttrs[e5] = s5.extended), this._data[3 * e5 + 0] = t5 | i6 << 22, this._data[3 * e5 + 1] = s5.fg, this._data[3 * e5 + 2] = s5.bg;
          }
          addCodepointToCell(e5, t5, i6) {
            let s5 = this._data[3 * e5 + 0];
            2097152 & s5 ? this._combined[e5] += (0, o3.stringFromCodePoint)(t5) : 2097151 & s5 ? (this._combined[e5] = (0, o3.stringFromCodePoint)(2097151 & s5) + (0, o3.stringFromCodePoint)(t5), s5 &= -2097152, s5 |= 2097152) : s5 = t5 | 1 << 22, i6 && (s5 &= -12582913, s5 |= i6 << 22), this._data[3 * e5 + 0] = s5;
          }
          insertCells(e5, t5, i6) {
            if ((e5 %= this.length) && 2 === this.getWidth(e5 - 1) && this.setCellFromCodepoint(e5 - 1, 0, 1, i6), t5 < this.length - e5) {
              const s5 = new r3.CellData();
              for (let i7 = this.length - e5 - t5 - 1; i7 >= 0; --i7) this.setCell(e5 + t5 + i7, this.loadCell(e5 + i7, s5));
              for (let s6 = 0; s6 < t5; ++s6) this.setCell(e5 + s6, i6);
            } else for (let t6 = e5; t6 < this.length; ++t6) this.setCell(t6, i6);
            2 === this.getWidth(this.length - 1) && this.setCellFromCodepoint(this.length - 1, 0, 1, i6);
          }
          deleteCells(e5, t5, i6) {
            if (e5 %= this.length, t5 < this.length - e5) {
              const s5 = new r3.CellData();
              for (let i7 = 0; i7 < this.length - e5 - t5; ++i7) this.setCell(e5 + i7, this.loadCell(e5 + t5 + i7, s5));
              for (let e6 = this.length - t5; e6 < this.length; ++e6) this.setCell(e6, i6);
            } else for (let t6 = e5; t6 < this.length; ++t6) this.setCell(t6, i6);
            e5 && 2 === this.getWidth(e5 - 1) && this.setCellFromCodepoint(e5 - 1, 0, 1, i6), 0 !== this.getWidth(e5) || this.hasContent(e5) || this.setCellFromCodepoint(e5, 0, 1, i6);
          }
          replaceCells(e5, t5, i6, s5 = false) {
            if (s5) for (e5 && 2 === this.getWidth(e5 - 1) && !this.isProtected(e5 - 1) && this.setCellFromCodepoint(e5 - 1, 0, 1, i6), t5 < this.length && 2 === this.getWidth(t5 - 1) && !this.isProtected(t5) && this.setCellFromCodepoint(t5, 0, 1, i6); e5 < t5 && e5 < this.length; ) this.isProtected(e5) || this.setCell(e5, i6), e5++;
            else for (e5 && 2 === this.getWidth(e5 - 1) && this.setCellFromCodepoint(e5 - 1, 0, 1, i6), t5 < this.length && 2 === this.getWidth(t5 - 1) && this.setCellFromCodepoint(t5, 0, 1, i6); e5 < t5 && e5 < this.length; ) this.setCell(e5++, i6);
          }
          resize(e5, t5) {
            if (e5 === this.length) return 4 * this._data.length * 2 < this._data.buffer.byteLength;
            const i6 = 3 * e5;
            if (e5 > this.length) {
              if (this._data.buffer.byteLength >= 4 * i6) this._data = new Uint32Array(this._data.buffer, 0, i6);
              else {
                const e6 = new Uint32Array(i6);
                e6.set(this._data), this._data = e6;
              }
              for (let i7 = this.length; i7 < e5; ++i7) this.setCell(i7, t5);
            } else {
              this._data = this._data.subarray(0, i6);
              const t6 = Object.keys(this._combined);
              for (let i7 = 0; i7 < t6.length; i7++) {
                const s6 = parseInt(t6[i7], 10);
                s6 >= e5 && delete this._combined[s6];
              }
              const s5 = Object.keys(this._extendedAttrs);
              for (let t7 = 0; t7 < s5.length; t7++) {
                const i7 = parseInt(s5[t7], 10);
                i7 >= e5 && delete this._extendedAttrs[i7];
              }
            }
            return this.length = e5, 4 * i6 * 2 < this._data.buffer.byteLength;
          }
          cleanupMemory() {
            if (4 * this._data.length * 2 < this._data.buffer.byteLength) {
              const e5 = new Uint32Array(this._data.length);
              return e5.set(this._data), this._data = e5, 1;
            }
            return 0;
          }
          fill(e5, t5 = false) {
            if (t5) for (let t6 = 0; t6 < this.length; ++t6) this.isProtected(t6) || this.setCell(t6, e5);
            else {
              this._combined = {}, this._extendedAttrs = {};
              for (let t6 = 0; t6 < this.length; ++t6) this.setCell(t6, e5);
            }
          }
          copyFrom(e5) {
            this.length !== e5.length ? this._data = new Uint32Array(e5._data) : this._data.set(e5._data), this.length = e5.length, this._combined = {};
            for (const t5 in e5._combined) this._combined[t5] = e5._combined[t5];
            this._extendedAttrs = {};
            for (const t5 in e5._extendedAttrs) this._extendedAttrs[t5] = e5._extendedAttrs[t5];
            this.isWrapped = e5.isWrapped;
          }
          clone() {
            const e5 = new h3(0);
            e5._data = new Uint32Array(this._data), e5.length = this.length;
            for (const t5 in this._combined) e5._combined[t5] = this._combined[t5];
            for (const t5 in this._extendedAttrs) e5._extendedAttrs[t5] = this._extendedAttrs[t5];
            return e5.isWrapped = this.isWrapped, e5;
          }
          getTrimmedLength() {
            for (let e5 = this.length - 1; e5 >= 0; --e5) if (4194303 & this._data[3 * e5 + 0]) return e5 + (this._data[3 * e5 + 0] >> 22);
            return 0;
          }
          getNoBgTrimmedLength() {
            for (let e5 = this.length - 1; e5 >= 0; --e5) if (4194303 & this._data[3 * e5 + 0] || 50331648 & this._data[3 * e5 + 2]) return e5 + (this._data[3 * e5 + 0] >> 22);
            return 0;
          }
          copyCellsFrom(e5, t5, i6, s5, r4) {
            const n3 = e5._data;
            if (r4) for (let r5 = s5 - 1; r5 >= 0; r5--) {
              for (let e6 = 0; e6 < 3; e6++) this._data[3 * (i6 + r5) + e6] = n3[3 * (t5 + r5) + e6];
              268435456 & n3[3 * (t5 + r5) + 2] && (this._extendedAttrs[i6 + r5] = e5._extendedAttrs[t5 + r5]);
            }
            else for (let r5 = 0; r5 < s5; r5++) {
              for (let e6 = 0; e6 < 3; e6++) this._data[3 * (i6 + r5) + e6] = n3[3 * (t5 + r5) + e6];
              268435456 & n3[3 * (t5 + r5) + 2] && (this._extendedAttrs[i6 + r5] = e5._extendedAttrs[t5 + r5]);
            }
            const o4 = Object.keys(e5._combined);
            for (let s6 = 0; s6 < o4.length; s6++) {
              const r5 = parseInt(o4[s6], 10);
              r5 >= t5 && (this._combined[r5 - t5 + i6] = e5._combined[r5]);
            }
          }
          translateToString(e5, t5, i6, s5) {
            t5 = t5 ?? 0, i6 = i6 ?? this.length, e5 && (i6 = Math.min(i6, this.getTrimmedLength())), s5 && (s5.length = 0);
            let r4 = "";
            for (; t5 < i6; ) {
              const e6 = this._data[3 * t5 + 0], i7 = 2097151 & e6, a4 = 2097152 & e6 ? this._combined[t5] : i7 ? (0, o3.stringFromCodePoint)(i7) : n2.WHITESPACE_CELL_CHAR;
              if (r4 += a4, s5) for (let e7 = 0; e7 < a4.length; ++e7) s5.push(t5);
              t5 += e6 >> 22 || 1;
            }
            return s5 && s5.push(t5), r4;
          }
        }
        t4.BufferLine = h3;
      }, 4841: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.getRangeLength = void 0, t4.getRangeLength = function(e5, t5) {
          if (e5.start.y > e5.end.y) throw new Error(`Buffer range end (${e5.end.x}, ${e5.end.y}) cannot be before start (${e5.start.x}, ${e5.start.y})`);
          return t5 * (e5.end.y - e5.start.y) + (e5.end.x - e5.start.x + 1);
        };
      }, 4634: (e4, t4) => {
        function i5(e5, t5, i6) {
          if (t5 === e5.length - 1) return e5[t5].getTrimmedLength();
          const s4 = !e5[t5].hasContent(i6 - 1) && 1 === e5[t5].getWidth(i6 - 1), r3 = 2 === e5[t5 + 1].getWidth(0);
          return s4 && r3 ? i6 - 1 : i6;
        }
        Object.defineProperty(t4, "__esModule", { value: true }), t4.getWrappedLineTrimmedLength = t4.reflowSmallerGetNewLineLengths = t4.reflowLargerApplyNewLayout = t4.reflowLargerCreateNewLayout = t4.reflowLargerGetLinesToRemove = void 0, t4.reflowLargerGetLinesToRemove = function(e5, t5, s4, r3, n2) {
          const o3 = [];
          for (let a3 = 0; a3 < e5.length - 1; a3++) {
            let h3 = a3, c3 = e5.get(++h3);
            if (!c3.isWrapped) continue;
            const l3 = [e5.get(a3)];
            for (; h3 < e5.length && c3.isWrapped; ) l3.push(c3), c3 = e5.get(++h3);
            if (r3 >= a3 && r3 < h3) {
              a3 += l3.length - 1;
              continue;
            }
            let d3 = 0, _2 = i5(l3, d3, t5), u4 = 1, f4 = 0;
            for (; u4 < l3.length; ) {
              const e6 = i5(l3, u4, t5), r4 = e6 - f4, o4 = s4 - _2, a4 = Math.min(r4, o4);
              l3[d3].copyCellsFrom(l3[u4], f4, _2, a4, false), _2 += a4, _2 === s4 && (d3++, _2 = 0), f4 += a4, f4 === e6 && (u4++, f4 = 0), 0 === _2 && 0 !== d3 && 2 === l3[d3 - 1].getWidth(s4 - 1) && (l3[d3].copyCellsFrom(l3[d3 - 1], s4 - 1, _2++, 1, false), l3[d3 - 1].setCell(s4 - 1, n2));
            }
            l3[d3].replaceCells(_2, s4, n2);
            let v3 = 0;
            for (let e6 = l3.length - 1; e6 > 0 && (e6 > d3 || 0 === l3[e6].getTrimmedLength()); e6--) v3++;
            v3 > 0 && (o3.push(a3 + l3.length - v3), o3.push(v3)), a3 += l3.length - 1;
          }
          return o3;
        }, t4.reflowLargerCreateNewLayout = function(e5, t5) {
          const i6 = [];
          let s4 = 0, r3 = t5[s4], n2 = 0;
          for (let o3 = 0; o3 < e5.length; o3++) if (r3 === o3) {
            const i7 = t5[++s4];
            e5.onDeleteEmitter.fire({ index: o3 - n2, amount: i7 }), o3 += i7 - 1, n2 += i7, r3 = t5[++s4];
          } else i6.push(o3);
          return { layout: i6, countRemoved: n2 };
        }, t4.reflowLargerApplyNewLayout = function(e5, t5) {
          const i6 = [];
          for (let s4 = 0; s4 < t5.length; s4++) i6.push(e5.get(t5[s4]));
          for (let t6 = 0; t6 < i6.length; t6++) e5.set(t6, i6[t6]);
          e5.length = t5.length;
        }, t4.reflowSmallerGetNewLineLengths = function(e5, t5, s4) {
          const r3 = [], n2 = e5.map((s5, r4) => i5(e5, r4, t5)).reduce((e6, t6) => e6 + t6);
          let o3 = 0, a3 = 0, h3 = 0;
          for (; h3 < n2; ) {
            if (n2 - h3 < s4) {
              r3.push(n2 - h3);
              break;
            }
            o3 += s4;
            const c3 = i5(e5, a3, t5);
            o3 > c3 && (o3 -= c3, a3++);
            const l3 = 2 === e5[a3].getWidth(o3 - 1);
            l3 && o3--;
            const d3 = l3 ? s4 - 1 : s4;
            r3.push(d3), h3 += d3;
          }
          return r3;
        }, t4.getWrappedLineTrimmedLength = i5;
      }, 5295: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.BufferSet = void 0;
        const s4 = i5(8460), r3 = i5(844), n2 = i5(9092);
        class o3 extends r3.Disposable {
          constructor(e5, t5) {
            super(), this._optionsService = e5, this._bufferService = t5, this._onBufferActivate = this.register(new s4.EventEmitter()), this.onBufferActivate = this._onBufferActivate.event, this.reset(), this.register(this._optionsService.onSpecificOptionChange("scrollback", () => this.resize(this._bufferService.cols, this._bufferService.rows))), this.register(this._optionsService.onSpecificOptionChange("tabStopWidth", () => this.setupTabStops()));
          }
          reset() {
            this._normal = new n2.Buffer(true, this._optionsService, this._bufferService), this._normal.fillViewportRows(), this._alt = new n2.Buffer(false, this._optionsService, this._bufferService), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }), this.setupTabStops();
          }
          get alt() {
            return this._alt;
          }
          get active() {
            return this._activeBuffer;
          }
          get normal() {
            return this._normal;
          }
          activateNormalBuffer() {
            this._activeBuffer !== this._normal && (this._normal.x = this._alt.x, this._normal.y = this._alt.y, this._alt.clearAllMarkers(), this._alt.clear(), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }));
          }
          activateAltBuffer(e5) {
            this._activeBuffer !== this._alt && (this._alt.fillViewportRows(e5), this._alt.x = this._normal.x, this._alt.y = this._normal.y, this._activeBuffer = this._alt, this._onBufferActivate.fire({ activeBuffer: this._alt, inactiveBuffer: this._normal }));
          }
          resize(e5, t5) {
            this._normal.resize(e5, t5), this._alt.resize(e5, t5), this.setupTabStops(e5);
          }
          setupTabStops(e5) {
            this._normal.setupTabStops(e5), this._alt.setupTabStops(e5);
          }
        }
        t4.BufferSet = o3;
      }, 511: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CellData = void 0;
        const s4 = i5(482), r3 = i5(643), n2 = i5(3734);
        class o3 extends n2.AttributeData {
          constructor() {
            super(...arguments), this.content = 0, this.fg = 0, this.bg = 0, this.extended = new n2.ExtendedAttrs(), this.combinedData = "";
          }
          static fromCharData(e5) {
            const t5 = new o3();
            return t5.setFromCharData(e5), t5;
          }
          isCombined() {
            return 2097152 & this.content;
          }
          getWidth() {
            return this.content >> 22;
          }
          getChars() {
            return 2097152 & this.content ? this.combinedData : 2097151 & this.content ? (0, s4.stringFromCodePoint)(2097151 & this.content) : "";
          }
          getCode() {
            return this.isCombined() ? this.combinedData.charCodeAt(this.combinedData.length - 1) : 2097151 & this.content;
          }
          setFromCharData(e5) {
            this.fg = e5[r3.CHAR_DATA_ATTR_INDEX], this.bg = 0;
            let t5 = false;
            if (e5[r3.CHAR_DATA_CHAR_INDEX].length > 2) t5 = true;
            else if (2 === e5[r3.CHAR_DATA_CHAR_INDEX].length) {
              const i6 = e5[r3.CHAR_DATA_CHAR_INDEX].charCodeAt(0);
              if (55296 <= i6 && i6 <= 56319) {
                const s5 = e5[r3.CHAR_DATA_CHAR_INDEX].charCodeAt(1);
                56320 <= s5 && s5 <= 57343 ? this.content = 1024 * (i6 - 55296) + s5 - 56320 + 65536 | e5[r3.CHAR_DATA_WIDTH_INDEX] << 22 : t5 = true;
              } else t5 = true;
            } else this.content = e5[r3.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | e5[r3.CHAR_DATA_WIDTH_INDEX] << 22;
            t5 && (this.combinedData = e5[r3.CHAR_DATA_CHAR_INDEX], this.content = 2097152 | e5[r3.CHAR_DATA_WIDTH_INDEX] << 22);
          }
          getAsCharData() {
            return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
          }
        }
        t4.CellData = o3;
      }, 643: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.WHITESPACE_CELL_CODE = t4.WHITESPACE_CELL_WIDTH = t4.WHITESPACE_CELL_CHAR = t4.NULL_CELL_CODE = t4.NULL_CELL_WIDTH = t4.NULL_CELL_CHAR = t4.CHAR_DATA_CODE_INDEX = t4.CHAR_DATA_WIDTH_INDEX = t4.CHAR_DATA_CHAR_INDEX = t4.CHAR_DATA_ATTR_INDEX = t4.DEFAULT_EXT = t4.DEFAULT_ATTR = t4.DEFAULT_COLOR = void 0, t4.DEFAULT_COLOR = 0, t4.DEFAULT_ATTR = 256 | t4.DEFAULT_COLOR << 9, t4.DEFAULT_EXT = 0, t4.CHAR_DATA_ATTR_INDEX = 0, t4.CHAR_DATA_CHAR_INDEX = 1, t4.CHAR_DATA_WIDTH_INDEX = 2, t4.CHAR_DATA_CODE_INDEX = 3, t4.NULL_CELL_CHAR = "", t4.NULL_CELL_WIDTH = 1, t4.NULL_CELL_CODE = 0, t4.WHITESPACE_CELL_CHAR = " ", t4.WHITESPACE_CELL_WIDTH = 1, t4.WHITESPACE_CELL_CODE = 32;
      }, 4863: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.Marker = void 0;
        const s4 = i5(8460), r3 = i5(844);
        class n2 {
          get id() {
            return this._id;
          }
          constructor(e5) {
            this.line = e5, this.isDisposed = false, this._disposables = [], this._id = n2._nextId++, this._onDispose = this.register(new s4.EventEmitter()), this.onDispose = this._onDispose.event;
          }
          dispose() {
            this.isDisposed || (this.isDisposed = true, this.line = -1, this._onDispose.fire(), (0, r3.disposeArray)(this._disposables), this._disposables.length = 0);
          }
          register(e5) {
            return this._disposables.push(e5), e5;
          }
        }
        t4.Marker = n2, n2._nextId = 1;
      }, 7116: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.DEFAULT_CHARSET = t4.CHARSETS = void 0, t4.CHARSETS = {}, t4.DEFAULT_CHARSET = t4.CHARSETS.B, t4.CHARSETS[0] = { "`": "\u25C6", a: "\u2592", b: "\u2409", c: "\u240C", d: "\u240D", e: "\u240A", f: "\xB0", g: "\xB1", h: "\u2424", i: "\u240B", j: "\u2518", k: "\u2510", l: "\u250C", m: "\u2514", n: "\u253C", o: "\u23BA", p: "\u23BB", q: "\u2500", r: "\u23BC", s: "\u23BD", t: "\u251C", u: "\u2524", v: "\u2534", w: "\u252C", x: "\u2502", y: "\u2264", z: "\u2265", "{": "\u03C0", "|": "\u2260", "}": "\xA3", "~": "\xB7" }, t4.CHARSETS.A = { "#": "\xA3" }, t4.CHARSETS.B = void 0, t4.CHARSETS[4] = { "#": "\xA3", "@": "\xBE", "[": "ij", "\\": "\xBD", "]": "|", "{": "\xA8", "|": "f", "}": "\xBC", "~": "\xB4" }, t4.CHARSETS.C = t4.CHARSETS[5] = { "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" }, t4.CHARSETS.R = { "#": "\xA3", "@": "\xE0", "[": "\xB0", "\\": "\xE7", "]": "\xA7", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xA8" }, t4.CHARSETS.Q = { "@": "\xE0", "[": "\xE2", "\\": "\xE7", "]": "\xEA", "^": "\xEE", "`": "\xF4", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xFB" }, t4.CHARSETS.K = { "@": "\xA7", "[": "\xC4", "\\": "\xD6", "]": "\xDC", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xDF" }, t4.CHARSETS.Y = { "#": "\xA3", "@": "\xA7", "[": "\xB0", "\\": "\xE7", "]": "\xE9", "`": "\xF9", "{": "\xE0", "|": "\xF2", "}": "\xE8", "~": "\xEC" }, t4.CHARSETS.E = t4.CHARSETS[6] = { "@": "\xC4", "[": "\xC6", "\\": "\xD8", "]": "\xC5", "^": "\xDC", "`": "\xE4", "{": "\xE6", "|": "\xF8", "}": "\xE5", "~": "\xFC" }, t4.CHARSETS.Z = { "#": "\xA3", "@": "\xA7", "[": "\xA1", "\\": "\xD1", "]": "\xBF", "{": "\xB0", "|": "\xF1", "}": "\xE7" }, t4.CHARSETS.H = t4.CHARSETS[7] = { "@": "\xC9", "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" }, t4.CHARSETS["="] = { "#": "\xF9", "@": "\xE0", "[": "\xE9", "\\": "\xE7", "]": "\xEA", "^": "\xEE", _: "\xE8", "`": "\xF4", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xFB" };
      }, 2584: (e4, t4) => {
        var i5, s4, r3;
        Object.defineProperty(t4, "__esModule", { value: true }), t4.C1_ESCAPED = t4.C1 = t4.C0 = void 0, function(e5) {
          e5.NUL = "\0", e5.SOH = "", e5.STX = "", e5.ETX = "", e5.EOT = "", e5.ENQ = "", e5.ACK = "", e5.BEL = "\x07", e5.BS = "\b", e5.HT = "	", e5.LF = "\n", e5.VT = "\v", e5.FF = "\f", e5.CR = "\r", e5.SO = "", e5.SI = "", e5.DLE = "", e5.DC1 = "", e5.DC2 = "", e5.DC3 = "", e5.DC4 = "", e5.NAK = "", e5.SYN = "", e5.ETB = "", e5.CAN = "", e5.EM = "", e5.SUB = "", e5.ESC = "\x1B", e5.FS = "", e5.GS = "", e5.RS = "", e5.US = "", e5.SP = " ", e5.DEL = "\x7F";
        }(i5 || (t4.C0 = i5 = {})), function(e5) {
          e5.PAD = "\x80", e5.HOP = "\x81", e5.BPH = "\x82", e5.NBH = "\x83", e5.IND = "\x84", e5.NEL = "\x85", e5.SSA = "\x86", e5.ESA = "\x87", e5.HTS = "\x88", e5.HTJ = "\x89", e5.VTS = "\x8A", e5.PLD = "\x8B", e5.PLU = "\x8C", e5.RI = "\x8D", e5.SS2 = "\x8E", e5.SS3 = "\x8F", e5.DCS = "\x90", e5.PU1 = "\x91", e5.PU2 = "\x92", e5.STS = "\x93", e5.CCH = "\x94", e5.MW = "\x95", e5.SPA = "\x96", e5.EPA = "\x97", e5.SOS = "\x98", e5.SGCI = "\x99", e5.SCI = "\x9A", e5.CSI = "\x9B", e5.ST = "\x9C", e5.OSC = "\x9D", e5.PM = "\x9E", e5.APC = "\x9F";
        }(s4 || (t4.C1 = s4 = {})), function(e5) {
          e5.ST = `${i5.ESC}\\`;
        }(r3 || (t4.C1_ESCAPED = r3 = {}));
      }, 7399: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.evaluateKeyboardEvent = void 0;
        const s4 = i5(2584), r3 = { 48: ["0", ")"], 49: ["1", "!"], 50: ["2", "@"], 51: ["3", "#"], 52: ["4", "$"], 53: ["5", "%"], 54: ["6", "^"], 55: ["7", "&"], 56: ["8", "*"], 57: ["9", "("], 186: [";", ":"], 187: ["=", "+"], 188: [",", "<"], 189: ["-", "_"], 190: [".", ">"], 191: ["/", "?"], 192: ["`", "~"], 219: ["[", "{"], 220: ["\\", "|"], 221: ["]", "}"], 222: ["'", '"'] };
        t4.evaluateKeyboardEvent = function(e5, t5, i6, n2) {
          const o3 = { type: 0, cancel: false, key: void 0 }, a3 = (e5.shiftKey ? 1 : 0) | (e5.altKey ? 2 : 0) | (e5.ctrlKey ? 4 : 0) | (e5.metaKey ? 8 : 0);
          switch (e5.keyCode) {
            case 0:
              "UIKeyInputUpArrow" === e5.key ? o3.key = t5 ? s4.C0.ESC + "OA" : s4.C0.ESC + "[A" : "UIKeyInputLeftArrow" === e5.key ? o3.key = t5 ? s4.C0.ESC + "OD" : s4.C0.ESC + "[D" : "UIKeyInputRightArrow" === e5.key ? o3.key = t5 ? s4.C0.ESC + "OC" : s4.C0.ESC + "[C" : "UIKeyInputDownArrow" === e5.key && (o3.key = t5 ? s4.C0.ESC + "OB" : s4.C0.ESC + "[B");
              break;
            case 8:
              o3.key = e5.ctrlKey ? "\b" : s4.C0.DEL, e5.altKey && (o3.key = s4.C0.ESC + o3.key);
              break;
            case 9:
              if (e5.shiftKey) {
                o3.key = s4.C0.ESC + "[Z";
                break;
              }
              o3.key = s4.C0.HT, o3.cancel = true;
              break;
            case 13:
              o3.key = e5.altKey ? s4.C0.ESC + s4.C0.CR : s4.C0.CR, o3.cancel = true;
              break;
            case 27:
              o3.key = s4.C0.ESC, e5.altKey && (o3.key = s4.C0.ESC + s4.C0.ESC), o3.cancel = true;
              break;
            case 37:
              if (e5.metaKey) break;
              a3 ? (o3.key = s4.C0.ESC + "[1;" + (a3 + 1) + "D", o3.key === s4.C0.ESC + "[1;3D" && (o3.key = s4.C0.ESC + (i6 ? "b" : "[1;5D"))) : o3.key = t5 ? s4.C0.ESC + "OD" : s4.C0.ESC + "[D";
              break;
            case 39:
              if (e5.metaKey) break;
              a3 ? (o3.key = s4.C0.ESC + "[1;" + (a3 + 1) + "C", o3.key === s4.C0.ESC + "[1;3C" && (o3.key = s4.C0.ESC + (i6 ? "f" : "[1;5C"))) : o3.key = t5 ? s4.C0.ESC + "OC" : s4.C0.ESC + "[C";
              break;
            case 38:
              if (e5.metaKey) break;
              a3 ? (o3.key = s4.C0.ESC + "[1;" + (a3 + 1) + "A", i6 || o3.key !== s4.C0.ESC + "[1;3A" || (o3.key = s4.C0.ESC + "[1;5A")) : o3.key = t5 ? s4.C0.ESC + "OA" : s4.C0.ESC + "[A";
              break;
            case 40:
              if (e5.metaKey) break;
              a3 ? (o3.key = s4.C0.ESC + "[1;" + (a3 + 1) + "B", i6 || o3.key !== s4.C0.ESC + "[1;3B" || (o3.key = s4.C0.ESC + "[1;5B")) : o3.key = t5 ? s4.C0.ESC + "OB" : s4.C0.ESC + "[B";
              break;
            case 45:
              e5.shiftKey || e5.ctrlKey || (o3.key = s4.C0.ESC + "[2~");
              break;
            case 46:
              o3.key = a3 ? s4.C0.ESC + "[3;" + (a3 + 1) + "~" : s4.C0.ESC + "[3~";
              break;
            case 36:
              o3.key = a3 ? s4.C0.ESC + "[1;" + (a3 + 1) + "H" : t5 ? s4.C0.ESC + "OH" : s4.C0.ESC + "[H";
              break;
            case 35:
              o3.key = a3 ? s4.C0.ESC + "[1;" + (a3 + 1) + "F" : t5 ? s4.C0.ESC + "OF" : s4.C0.ESC + "[F";
              break;
            case 33:
              e5.shiftKey ? o3.type = 2 : e5.ctrlKey ? o3.key = s4.C0.ESC + "[5;" + (a3 + 1) + "~" : o3.key = s4.C0.ESC + "[5~";
              break;
            case 34:
              e5.shiftKey ? o3.type = 3 : e5.ctrlKey ? o3.key = s4.C0.ESC + "[6;" + (a3 + 1) + "~" : o3.key = s4.C0.ESC + "[6~";
              break;
            case 112:
              o3.key = a3 ? s4.C0.ESC + "[1;" + (a3 + 1) + "P" : s4.C0.ESC + "OP";
              break;
            case 113:
              o3.key = a3 ? s4.C0.ESC + "[1;" + (a3 + 1) + "Q" : s4.C0.ESC + "OQ";
              break;
            case 114:
              o3.key = a3 ? s4.C0.ESC + "[1;" + (a3 + 1) + "R" : s4.C0.ESC + "OR";
              break;
            case 115:
              o3.key = a3 ? s4.C0.ESC + "[1;" + (a3 + 1) + "S" : s4.C0.ESC + "OS";
              break;
            case 116:
              o3.key = a3 ? s4.C0.ESC + "[15;" + (a3 + 1) + "~" : s4.C0.ESC + "[15~";
              break;
            case 117:
              o3.key = a3 ? s4.C0.ESC + "[17;" + (a3 + 1) + "~" : s4.C0.ESC + "[17~";
              break;
            case 118:
              o3.key = a3 ? s4.C0.ESC + "[18;" + (a3 + 1) + "~" : s4.C0.ESC + "[18~";
              break;
            case 119:
              o3.key = a3 ? s4.C0.ESC + "[19;" + (a3 + 1) + "~" : s4.C0.ESC + "[19~";
              break;
            case 120:
              o3.key = a3 ? s4.C0.ESC + "[20;" + (a3 + 1) + "~" : s4.C0.ESC + "[20~";
              break;
            case 121:
              o3.key = a3 ? s4.C0.ESC + "[21;" + (a3 + 1) + "~" : s4.C0.ESC + "[21~";
              break;
            case 122:
              o3.key = a3 ? s4.C0.ESC + "[23;" + (a3 + 1) + "~" : s4.C0.ESC + "[23~";
              break;
            case 123:
              o3.key = a3 ? s4.C0.ESC + "[24;" + (a3 + 1) + "~" : s4.C0.ESC + "[24~";
              break;
            default:
              if (!e5.ctrlKey || e5.shiftKey || e5.altKey || e5.metaKey) if (i6 && !n2 || !e5.altKey || e5.metaKey) !i6 || e5.altKey || e5.ctrlKey || e5.shiftKey || !e5.metaKey ? e5.key && !e5.ctrlKey && !e5.altKey && !e5.metaKey && e5.keyCode >= 48 && 1 === e5.key.length ? o3.key = e5.key : e5.key && e5.ctrlKey && ("_" === e5.key && (o3.key = s4.C0.US), "@" === e5.key && (o3.key = s4.C0.NUL)) : 65 === e5.keyCode && (o3.type = 1);
              else {
                const t6 = r3[e5.keyCode], i7 = t6?.[e5.shiftKey ? 1 : 0];
                if (i7) o3.key = s4.C0.ESC + i7;
                else if (e5.keyCode >= 65 && e5.keyCode <= 90) {
                  const t7 = e5.ctrlKey ? e5.keyCode - 64 : e5.keyCode + 32;
                  let i8 = String.fromCharCode(t7);
                  e5.shiftKey && (i8 = i8.toUpperCase()), o3.key = s4.C0.ESC + i8;
                } else if (32 === e5.keyCode) o3.key = s4.C0.ESC + (e5.ctrlKey ? s4.C0.NUL : " ");
                else if ("Dead" === e5.key && e5.code.startsWith("Key")) {
                  let t7 = e5.code.slice(3, 4);
                  e5.shiftKey || (t7 = t7.toLowerCase()), o3.key = s4.C0.ESC + t7, o3.cancel = true;
                }
              }
              else e5.keyCode >= 65 && e5.keyCode <= 90 ? o3.key = String.fromCharCode(e5.keyCode - 64) : 32 === e5.keyCode ? o3.key = s4.C0.NUL : e5.keyCode >= 51 && e5.keyCode <= 55 ? o3.key = String.fromCharCode(e5.keyCode - 51 + 27) : 56 === e5.keyCode ? o3.key = s4.C0.DEL : 219 === e5.keyCode ? o3.key = s4.C0.ESC : 220 === e5.keyCode ? o3.key = s4.C0.FS : 221 === e5.keyCode && (o3.key = s4.C0.GS);
          }
          return o3;
        };
      }, 482: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.Utf8ToUtf32 = t4.StringToUtf32 = t4.utf32ToString = t4.stringFromCodePoint = void 0, t4.stringFromCodePoint = function(e5) {
          return e5 > 65535 ? (e5 -= 65536, String.fromCharCode(55296 + (e5 >> 10)) + String.fromCharCode(e5 % 1024 + 56320)) : String.fromCharCode(e5);
        }, t4.utf32ToString = function(e5, t5 = 0, i5 = e5.length) {
          let s4 = "";
          for (let r3 = t5; r3 < i5; ++r3) {
            let t6 = e5[r3];
            t6 > 65535 ? (t6 -= 65536, s4 += String.fromCharCode(55296 + (t6 >> 10)) + String.fromCharCode(t6 % 1024 + 56320)) : s4 += String.fromCharCode(t6);
          }
          return s4;
        }, t4.StringToUtf32 = class {
          constructor() {
            this._interim = 0;
          }
          clear() {
            this._interim = 0;
          }
          decode(e5, t5) {
            const i5 = e5.length;
            if (!i5) return 0;
            let s4 = 0, r3 = 0;
            if (this._interim) {
              const i6 = e5.charCodeAt(r3++);
              56320 <= i6 && i6 <= 57343 ? t5[s4++] = 1024 * (this._interim - 55296) + i6 - 56320 + 65536 : (t5[s4++] = this._interim, t5[s4++] = i6), this._interim = 0;
            }
            for (let n2 = r3; n2 < i5; ++n2) {
              const r4 = e5.charCodeAt(n2);
              if (55296 <= r4 && r4 <= 56319) {
                if (++n2 >= i5) return this._interim = r4, s4;
                const o3 = e5.charCodeAt(n2);
                56320 <= o3 && o3 <= 57343 ? t5[s4++] = 1024 * (r4 - 55296) + o3 - 56320 + 65536 : (t5[s4++] = r4, t5[s4++] = o3);
              } else 65279 !== r4 && (t5[s4++] = r4);
            }
            return s4;
          }
        }, t4.Utf8ToUtf32 = class {
          constructor() {
            this.interim = new Uint8Array(3);
          }
          clear() {
            this.interim.fill(0);
          }
          decode(e5, t5) {
            const i5 = e5.length;
            if (!i5) return 0;
            let s4, r3, n2, o3, a3 = 0, h3 = 0, c3 = 0;
            if (this.interim[0]) {
              let s5 = false, r4 = this.interim[0];
              r4 &= 192 == (224 & r4) ? 31 : 224 == (240 & r4) ? 15 : 7;
              let n3, o4 = 0;
              for (; (n3 = 63 & this.interim[++o4]) && o4 < 4; ) r4 <<= 6, r4 |= n3;
              const h4 = 192 == (224 & this.interim[0]) ? 2 : 224 == (240 & this.interim[0]) ? 3 : 4, l4 = h4 - o4;
              for (; c3 < l4; ) {
                if (c3 >= i5) return 0;
                if (n3 = e5[c3++], 128 != (192 & n3)) {
                  c3--, s5 = true;
                  break;
                }
                this.interim[o4++] = n3, r4 <<= 6, r4 |= 63 & n3;
              }
              s5 || (2 === h4 ? r4 < 128 ? c3-- : t5[a3++] = r4 : 3 === h4 ? r4 < 2048 || r4 >= 55296 && r4 <= 57343 || 65279 === r4 || (t5[a3++] = r4) : r4 < 65536 || r4 > 1114111 || (t5[a3++] = r4)), this.interim.fill(0);
            }
            const l3 = i5 - 4;
            let d3 = c3;
            for (; d3 < i5; ) {
              for (; !(!(d3 < l3) || 128 & (s4 = e5[d3]) || 128 & (r3 = e5[d3 + 1]) || 128 & (n2 = e5[d3 + 2]) || 128 & (o3 = e5[d3 + 3])); ) t5[a3++] = s4, t5[a3++] = r3, t5[a3++] = n2, t5[a3++] = o3, d3 += 4;
              if (s4 = e5[d3++], s4 < 128) t5[a3++] = s4;
              else if (192 == (224 & s4)) {
                if (d3 >= i5) return this.interim[0] = s4, a3;
                if (r3 = e5[d3++], 128 != (192 & r3)) {
                  d3--;
                  continue;
                }
                if (h3 = (31 & s4) << 6 | 63 & r3, h3 < 128) {
                  d3--;
                  continue;
                }
                t5[a3++] = h3;
              } else if (224 == (240 & s4)) {
                if (d3 >= i5) return this.interim[0] = s4, a3;
                if (r3 = e5[d3++], 128 != (192 & r3)) {
                  d3--;
                  continue;
                }
                if (d3 >= i5) return this.interim[0] = s4, this.interim[1] = r3, a3;
                if (n2 = e5[d3++], 128 != (192 & n2)) {
                  d3--;
                  continue;
                }
                if (h3 = (15 & s4) << 12 | (63 & r3) << 6 | 63 & n2, h3 < 2048 || h3 >= 55296 && h3 <= 57343 || 65279 === h3) continue;
                t5[a3++] = h3;
              } else if (240 == (248 & s4)) {
                if (d3 >= i5) return this.interim[0] = s4, a3;
                if (r3 = e5[d3++], 128 != (192 & r3)) {
                  d3--;
                  continue;
                }
                if (d3 >= i5) return this.interim[0] = s4, this.interim[1] = r3, a3;
                if (n2 = e5[d3++], 128 != (192 & n2)) {
                  d3--;
                  continue;
                }
                if (d3 >= i5) return this.interim[0] = s4, this.interim[1] = r3, this.interim[2] = n2, a3;
                if (o3 = e5[d3++], 128 != (192 & o3)) {
                  d3--;
                  continue;
                }
                if (h3 = (7 & s4) << 18 | (63 & r3) << 12 | (63 & n2) << 6 | 63 & o3, h3 < 65536 || h3 > 1114111) continue;
                t5[a3++] = h3;
              }
            }
            return a3;
          }
        };
      }, 225: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.UnicodeV6 = void 0;
        const s4 = i5(1480), r3 = [[768, 879], [1155, 1158], [1160, 1161], [1425, 1469], [1471, 1471], [1473, 1474], [1476, 1477], [1479, 1479], [1536, 1539], [1552, 1557], [1611, 1630], [1648, 1648], [1750, 1764], [1767, 1768], [1770, 1773], [1807, 1807], [1809, 1809], [1840, 1866], [1958, 1968], [2027, 2035], [2305, 2306], [2364, 2364], [2369, 2376], [2381, 2381], [2385, 2388], [2402, 2403], [2433, 2433], [2492, 2492], [2497, 2500], [2509, 2509], [2530, 2531], [2561, 2562], [2620, 2620], [2625, 2626], [2631, 2632], [2635, 2637], [2672, 2673], [2689, 2690], [2748, 2748], [2753, 2757], [2759, 2760], [2765, 2765], [2786, 2787], [2817, 2817], [2876, 2876], [2879, 2879], [2881, 2883], [2893, 2893], [2902, 2902], [2946, 2946], [3008, 3008], [3021, 3021], [3134, 3136], [3142, 3144], [3146, 3149], [3157, 3158], [3260, 3260], [3263, 3263], [3270, 3270], [3276, 3277], [3298, 3299], [3393, 3395], [3405, 3405], [3530, 3530], [3538, 3540], [3542, 3542], [3633, 3633], [3636, 3642], [3655, 3662], [3761, 3761], [3764, 3769], [3771, 3772], [3784, 3789], [3864, 3865], [3893, 3893], [3895, 3895], [3897, 3897], [3953, 3966], [3968, 3972], [3974, 3975], [3984, 3991], [3993, 4028], [4038, 4038], [4141, 4144], [4146, 4146], [4150, 4151], [4153, 4153], [4184, 4185], [4448, 4607], [4959, 4959], [5906, 5908], [5938, 5940], [5970, 5971], [6002, 6003], [6068, 6069], [6071, 6077], [6086, 6086], [6089, 6099], [6109, 6109], [6155, 6157], [6313, 6313], [6432, 6434], [6439, 6440], [6450, 6450], [6457, 6459], [6679, 6680], [6912, 6915], [6964, 6964], [6966, 6970], [6972, 6972], [6978, 6978], [7019, 7027], [7616, 7626], [7678, 7679], [8203, 8207], [8234, 8238], [8288, 8291], [8298, 8303], [8400, 8431], [12330, 12335], [12441, 12442], [43014, 43014], [43019, 43019], [43045, 43046], [64286, 64286], [65024, 65039], [65056, 65059], [65279, 65279], [65529, 65531]], n2 = [[68097, 68099], [68101, 68102], [68108, 68111], [68152, 68154], [68159, 68159], [119143, 119145], [119155, 119170], [119173, 119179], [119210, 119213], [119362, 119364], [917505, 917505], [917536, 917631], [917760, 917999]];
        let o3;
        t4.UnicodeV6 = class {
          constructor() {
            if (this.version = "6", !o3) {
              o3 = new Uint8Array(65536), o3.fill(1), o3[0] = 0, o3.fill(0, 1, 32), o3.fill(0, 127, 160), o3.fill(2, 4352, 4448), o3[9001] = 2, o3[9002] = 2, o3.fill(2, 11904, 42192), o3[12351] = 1, o3.fill(2, 44032, 55204), o3.fill(2, 63744, 64256), o3.fill(2, 65040, 65050), o3.fill(2, 65072, 65136), o3.fill(2, 65280, 65377), o3.fill(2, 65504, 65511);
              for (let e5 = 0; e5 < r3.length; ++e5) o3.fill(0, r3[e5][0], r3[e5][1] + 1);
            }
          }
          wcwidth(e5) {
            return e5 < 32 ? 0 : e5 < 127 ? 1 : e5 < 65536 ? o3[e5] : function(e6, t5) {
              let i6, s5 = 0, r4 = t5.length - 1;
              if (e6 < t5[0][0] || e6 > t5[r4][1]) return false;
              for (; r4 >= s5; ) if (i6 = s5 + r4 >> 1, e6 > t5[i6][1]) s5 = i6 + 1;
              else {
                if (!(e6 < t5[i6][0])) return true;
                r4 = i6 - 1;
              }
              return false;
            }(e5, n2) ? 0 : e5 >= 131072 && e5 <= 196605 || e5 >= 196608 && e5 <= 262141 ? 2 : 1;
          }
          charProperties(e5, t5) {
            let i6 = this.wcwidth(e5), r4 = 0 === i6 && 0 !== t5;
            if (r4) {
              const e6 = s4.UnicodeService.extractWidth(t5);
              0 === e6 ? r4 = false : e6 > i6 && (i6 = e6);
            }
            return s4.UnicodeService.createPropertyValue(0, i6, r4);
          }
        };
      }, 5981: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.WriteBuffer = void 0;
        const s4 = i5(8460), r3 = i5(844);
        class n2 extends r3.Disposable {
          constructor(e5) {
            super(), this._action = e5, this._writeBuffer = [], this._callbacks = [], this._pendingData = 0, this._bufferOffset = 0, this._isSyncWriting = false, this._syncCalls = 0, this._didUserInput = false, this._onWriteParsed = this.register(new s4.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event;
          }
          handleUserInput() {
            this._didUserInput = true;
          }
          writeSync(e5, t5) {
            if (void 0 !== t5 && this._syncCalls > t5) return void (this._syncCalls = 0);
            if (this._pendingData += e5.length, this._writeBuffer.push(e5), this._callbacks.push(void 0), this._syncCalls++, this._isSyncWriting) return;
            let i6;
            for (this._isSyncWriting = true; i6 = this._writeBuffer.shift(); ) {
              this._action(i6);
              const e6 = this._callbacks.shift();
              e6 && e6();
            }
            this._pendingData = 0, this._bufferOffset = 2147483647, this._isSyncWriting = false, this._syncCalls = 0;
          }
          write(e5, t5) {
            if (this._pendingData > 5e7) throw new Error("write data discarded, use flow control to avoid losing data");
            if (!this._writeBuffer.length) {
              if (this._bufferOffset = 0, this._didUserInput) return this._didUserInput = false, this._pendingData += e5.length, this._writeBuffer.push(e5), this._callbacks.push(t5), void this._innerWrite();
              setTimeout(() => this._innerWrite());
            }
            this._pendingData += e5.length, this._writeBuffer.push(e5), this._callbacks.push(t5);
          }
          _innerWrite(e5 = 0, t5 = true) {
            const i6 = e5 || Date.now();
            for (; this._writeBuffer.length > this._bufferOffset; ) {
              const e6 = this._writeBuffer[this._bufferOffset], s5 = this._action(e6, t5);
              if (s5) {
                const e7 = (e8) => Date.now() - i6 >= 12 ? setTimeout(() => this._innerWrite(0, e8)) : this._innerWrite(i6, e8);
                return void s5.catch((e8) => (queueMicrotask(() => {
                  throw e8;
                }), Promise.resolve(false))).then(e7);
              }
              const r4 = this._callbacks[this._bufferOffset];
              if (r4 && r4(), this._bufferOffset++, this._pendingData -= e6.length, Date.now() - i6 >= 12) break;
            }
            this._writeBuffer.length > this._bufferOffset ? (this._bufferOffset > 50 && (this._writeBuffer = this._writeBuffer.slice(this._bufferOffset), this._callbacks = this._callbacks.slice(this._bufferOffset), this._bufferOffset = 0), setTimeout(() => this._innerWrite())) : (this._writeBuffer.length = 0, this._callbacks.length = 0, this._pendingData = 0, this._bufferOffset = 0), this._onWriteParsed.fire();
          }
        }
        t4.WriteBuffer = n2;
      }, 5941: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.toRgbString = t4.parseColor = void 0;
        const i5 = /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/, s4 = /^[\da-f]+$/;
        function r3(e5, t5) {
          const i6 = e5.toString(16), s5 = i6.length < 2 ? "0" + i6 : i6;
          switch (t5) {
            case 4:
              return i6[0];
            case 8:
              return s5;
            case 12:
              return (s5 + s5).slice(0, 3);
            default:
              return s5 + s5;
          }
        }
        t4.parseColor = function(e5) {
          if (!e5) return;
          let t5 = e5.toLowerCase();
          if (0 === t5.indexOf("rgb:")) {
            t5 = t5.slice(4);
            const e6 = i5.exec(t5);
            if (e6) {
              const t6 = e6[1] ? 15 : e6[4] ? 255 : e6[7] ? 4095 : 65535;
              return [Math.round(parseInt(e6[1] || e6[4] || e6[7] || e6[10], 16) / t6 * 255), Math.round(parseInt(e6[2] || e6[5] || e6[8] || e6[11], 16) / t6 * 255), Math.round(parseInt(e6[3] || e6[6] || e6[9] || e6[12], 16) / t6 * 255)];
            }
          } else if (0 === t5.indexOf("#") && (t5 = t5.slice(1), s4.exec(t5) && [3, 6, 9, 12].includes(t5.length))) {
            const e6 = t5.length / 3, i6 = [0, 0, 0];
            for (let s5 = 0; s5 < 3; ++s5) {
              const r4 = parseInt(t5.slice(e6 * s5, e6 * s5 + e6), 16);
              i6[s5] = 1 === e6 ? r4 << 4 : 2 === e6 ? r4 : 3 === e6 ? r4 >> 4 : r4 >> 8;
            }
            return i6;
          }
        }, t4.toRgbString = function(e5, t5 = 16) {
          const [i6, s5, n2] = e5;
          return `rgb:${r3(i6, t5)}/${r3(s5, t5)}/${r3(n2, t5)}`;
        };
      }, 5770: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.PAYLOAD_LIMIT = void 0, t4.PAYLOAD_LIMIT = 1e7;
      }, 6351: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.DcsHandler = t4.DcsParser = void 0;
        const s4 = i5(482), r3 = i5(8742), n2 = i5(5770), o3 = [];
        t4.DcsParser = class {
          constructor() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._active = o3, this._ident = 0, this._handlerFb = () => {
            }, this._stack = { paused: false, loopPosition: 0, fallThrough: false };
          }
          dispose() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._active = o3;
          }
          registerHandler(e5, t5) {
            void 0 === this._handlers[e5] && (this._handlers[e5] = []);
            const i6 = this._handlers[e5];
            return i6.push(t5), { dispose: () => {
              const e6 = i6.indexOf(t5);
              -1 !== e6 && i6.splice(e6, 1);
            } };
          }
          clearHandler(e5) {
            this._handlers[e5] && delete this._handlers[e5];
          }
          setHandlerFallback(e5) {
            this._handlerFb = e5;
          }
          reset() {
            if (this._active.length) for (let e5 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e5 >= 0; --e5) this._active[e5].unhook(false);
            this._stack.paused = false, this._active = o3, this._ident = 0;
          }
          hook(e5, t5) {
            if (this.reset(), this._ident = e5, this._active = this._handlers[e5] || o3, this._active.length) for (let e6 = this._active.length - 1; e6 >= 0; e6--) this._active[e6].hook(t5);
            else this._handlerFb(this._ident, "HOOK", t5);
          }
          put(e5, t5, i6) {
            if (this._active.length) for (let s5 = this._active.length - 1; s5 >= 0; s5--) this._active[s5].put(e5, t5, i6);
            else this._handlerFb(this._ident, "PUT", (0, s4.utf32ToString)(e5, t5, i6));
          }
          unhook(e5, t5 = true) {
            if (this._active.length) {
              let i6 = false, s5 = this._active.length - 1, r4 = false;
              if (this._stack.paused && (s5 = this._stack.loopPosition - 1, i6 = t5, r4 = this._stack.fallThrough, this._stack.paused = false), !r4 && false === i6) {
                for (; s5 >= 0 && (i6 = this._active[s5].unhook(e5), true !== i6); s5--) if (i6 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s5, this._stack.fallThrough = false, i6;
                s5--;
              }
              for (; s5 >= 0; s5--) if (i6 = this._active[s5].unhook(false), i6 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s5, this._stack.fallThrough = true, i6;
            } else this._handlerFb(this._ident, "UNHOOK", e5);
            this._active = o3, this._ident = 0;
          }
        };
        const a3 = new r3.Params();
        a3.addParam(0), t4.DcsHandler = class {
          constructor(e5) {
            this._handler = e5, this._data = "", this._params = a3, this._hitLimit = false;
          }
          hook(e5) {
            this._params = e5.length > 1 || e5.params[0] ? e5.clone() : a3, this._data = "", this._hitLimit = false;
          }
          put(e5, t5, i6) {
            this._hitLimit || (this._data += (0, s4.utf32ToString)(e5, t5, i6), this._data.length > n2.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = true));
          }
          unhook(e5) {
            let t5 = false;
            if (this._hitLimit) t5 = false;
            else if (e5 && (t5 = this._handler(this._data, this._params), t5 instanceof Promise)) return t5.then((e6) => (this._params = a3, this._data = "", this._hitLimit = false, e6));
            return this._params = a3, this._data = "", this._hitLimit = false, t5;
          }
        };
      }, 2015: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.EscapeSequenceParser = t4.VT500_TRANSITION_TABLE = t4.TransitionTable = void 0;
        const s4 = i5(844), r3 = i5(8742), n2 = i5(6242), o3 = i5(6351);
        class a3 {
          constructor(e5) {
            this.table = new Uint8Array(e5);
          }
          setDefault(e5, t5) {
            this.table.fill(e5 << 4 | t5);
          }
          add(e5, t5, i6, s5) {
            this.table[t5 << 8 | e5] = i6 << 4 | s5;
          }
          addMany(e5, t5, i6, s5) {
            for (let r4 = 0; r4 < e5.length; r4++) this.table[t5 << 8 | e5[r4]] = i6 << 4 | s5;
          }
        }
        t4.TransitionTable = a3;
        const h3 = 160;
        t4.VT500_TRANSITION_TABLE = function() {
          const e5 = new a3(4095), t5 = Array.apply(null, Array(256)).map((e6, t6) => t6), i6 = (e6, i7) => t5.slice(e6, i7), s5 = i6(32, 127), r4 = i6(0, 24);
          r4.push(25), r4.push.apply(r4, i6(28, 32));
          const n3 = i6(0, 14);
          let o4;
          for (o4 in e5.setDefault(1, 0), e5.addMany(s5, 0, 2, 0), n3) e5.addMany([24, 26, 153, 154], o4, 3, 0), e5.addMany(i6(128, 144), o4, 3, 0), e5.addMany(i6(144, 152), o4, 3, 0), e5.add(156, o4, 0, 0), e5.add(27, o4, 11, 1), e5.add(157, o4, 4, 8), e5.addMany([152, 158, 159], o4, 0, 7), e5.add(155, o4, 11, 3), e5.add(144, o4, 11, 9);
          return e5.addMany(r4, 0, 3, 0), e5.addMany(r4, 1, 3, 1), e5.add(127, 1, 0, 1), e5.addMany(r4, 8, 0, 8), e5.addMany(r4, 3, 3, 3), e5.add(127, 3, 0, 3), e5.addMany(r4, 4, 3, 4), e5.add(127, 4, 0, 4), e5.addMany(r4, 6, 3, 6), e5.addMany(r4, 5, 3, 5), e5.add(127, 5, 0, 5), e5.addMany(r4, 2, 3, 2), e5.add(127, 2, 0, 2), e5.add(93, 1, 4, 8), e5.addMany(s5, 8, 5, 8), e5.add(127, 8, 5, 8), e5.addMany([156, 27, 24, 26, 7], 8, 6, 0), e5.addMany(i6(28, 32), 8, 0, 8), e5.addMany([88, 94, 95], 1, 0, 7), e5.addMany(s5, 7, 0, 7), e5.addMany(r4, 7, 0, 7), e5.add(156, 7, 0, 0), e5.add(127, 7, 0, 7), e5.add(91, 1, 11, 3), e5.addMany(i6(64, 127), 3, 7, 0), e5.addMany(i6(48, 60), 3, 8, 4), e5.addMany([60, 61, 62, 63], 3, 9, 4), e5.addMany(i6(48, 60), 4, 8, 4), e5.addMany(i6(64, 127), 4, 7, 0), e5.addMany([60, 61, 62, 63], 4, 0, 6), e5.addMany(i6(32, 64), 6, 0, 6), e5.add(127, 6, 0, 6), e5.addMany(i6(64, 127), 6, 0, 0), e5.addMany(i6(32, 48), 3, 9, 5), e5.addMany(i6(32, 48), 5, 9, 5), e5.addMany(i6(48, 64), 5, 0, 6), e5.addMany(i6(64, 127), 5, 7, 0), e5.addMany(i6(32, 48), 4, 9, 5), e5.addMany(i6(32, 48), 1, 9, 2), e5.addMany(i6(32, 48), 2, 9, 2), e5.addMany(i6(48, 127), 2, 10, 0), e5.addMany(i6(48, 80), 1, 10, 0), e5.addMany(i6(81, 88), 1, 10, 0), e5.addMany([89, 90, 92], 1, 10, 0), e5.addMany(i6(96, 127), 1, 10, 0), e5.add(80, 1, 11, 9), e5.addMany(r4, 9, 0, 9), e5.add(127, 9, 0, 9), e5.addMany(i6(28, 32), 9, 0, 9), e5.addMany(i6(32, 48), 9, 9, 12), e5.addMany(i6(48, 60), 9, 8, 10), e5.addMany([60, 61, 62, 63], 9, 9, 10), e5.addMany(r4, 11, 0, 11), e5.addMany(i6(32, 128), 11, 0, 11), e5.addMany(i6(28, 32), 11, 0, 11), e5.addMany(r4, 10, 0, 10), e5.add(127, 10, 0, 10), e5.addMany(i6(28, 32), 10, 0, 10), e5.addMany(i6(48, 60), 10, 8, 10), e5.addMany([60, 61, 62, 63], 10, 0, 11), e5.addMany(i6(32, 48), 10, 9, 12), e5.addMany(r4, 12, 0, 12), e5.add(127, 12, 0, 12), e5.addMany(i6(28, 32), 12, 0, 12), e5.addMany(i6(32, 48), 12, 9, 12), e5.addMany(i6(48, 64), 12, 0, 11), e5.addMany(i6(64, 127), 12, 12, 13), e5.addMany(i6(64, 127), 10, 12, 13), e5.addMany(i6(64, 127), 9, 12, 13), e5.addMany(r4, 13, 13, 13), e5.addMany(s5, 13, 13, 13), e5.add(127, 13, 0, 13), e5.addMany([27, 156, 24, 26], 13, 14, 0), e5.add(h3, 0, 2, 0), e5.add(h3, 8, 5, 8), e5.add(h3, 6, 0, 6), e5.add(h3, 11, 0, 11), e5.add(h3, 13, 13, 13), e5;
        }();
        class c3 extends s4.Disposable {
          constructor(e5 = t4.VT500_TRANSITION_TABLE) {
            super(), this._transitions = e5, this._parseStack = { state: 0, handlers: [], handlerPos: 0, transition: 0, chunkPos: 0 }, this.initialState = 0, this.currentState = this.initialState, this._params = new r3.Params(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._printHandlerFb = (e6, t5, i6) => {
            }, this._executeHandlerFb = (e6) => {
            }, this._csiHandlerFb = (e6, t5) => {
            }, this._escHandlerFb = (e6) => {
            }, this._errorHandlerFb = (e6) => e6, this._printHandler = this._printHandlerFb, this._executeHandlers = /* @__PURE__ */ Object.create(null), this._csiHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null), this.register((0, s4.toDisposable)(() => {
              this._csiHandlers = /* @__PURE__ */ Object.create(null), this._executeHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null);
            })), this._oscParser = this.register(new n2.OscParser()), this._dcsParser = this.register(new o3.DcsParser()), this._errorHandler = this._errorHandlerFb, this.registerEscHandler({ final: "\\" }, () => true);
          }
          _identifier(e5, t5 = [64, 126]) {
            let i6 = 0;
            if (e5.prefix) {
              if (e5.prefix.length > 1) throw new Error("only one byte as prefix supported");
              if (i6 = e5.prefix.charCodeAt(0), i6 && 60 > i6 || i6 > 63) throw new Error("prefix must be in range 0x3c .. 0x3f");
            }
            if (e5.intermediates) {
              if (e5.intermediates.length > 2) throw new Error("only two bytes as intermediates are supported");
              for (let t6 = 0; t6 < e5.intermediates.length; ++t6) {
                const s6 = e5.intermediates.charCodeAt(t6);
                if (32 > s6 || s6 > 47) throw new Error("intermediate must be in range 0x20 .. 0x2f");
                i6 <<= 8, i6 |= s6;
              }
            }
            if (1 !== e5.final.length) throw new Error("final must be a single byte");
            const s5 = e5.final.charCodeAt(0);
            if (t5[0] > s5 || s5 > t5[1]) throw new Error(`final must be in range ${t5[0]} .. ${t5[1]}`);
            return i6 <<= 8, i6 |= s5, i6;
          }
          identToString(e5) {
            const t5 = [];
            for (; e5; ) t5.push(String.fromCharCode(255 & e5)), e5 >>= 8;
            return t5.reverse().join("");
          }
          setPrintHandler(e5) {
            this._printHandler = e5;
          }
          clearPrintHandler() {
            this._printHandler = this._printHandlerFb;
          }
          registerEscHandler(e5, t5) {
            const i6 = this._identifier(e5, [48, 126]);
            void 0 === this._escHandlers[i6] && (this._escHandlers[i6] = []);
            const s5 = this._escHandlers[i6];
            return s5.push(t5), { dispose: () => {
              const e6 = s5.indexOf(t5);
              -1 !== e6 && s5.splice(e6, 1);
            } };
          }
          clearEscHandler(e5) {
            this._escHandlers[this._identifier(e5, [48, 126])] && delete this._escHandlers[this._identifier(e5, [48, 126])];
          }
          setEscHandlerFallback(e5) {
            this._escHandlerFb = e5;
          }
          setExecuteHandler(e5, t5) {
            this._executeHandlers[e5.charCodeAt(0)] = t5;
          }
          clearExecuteHandler(e5) {
            this._executeHandlers[e5.charCodeAt(0)] && delete this._executeHandlers[e5.charCodeAt(0)];
          }
          setExecuteHandlerFallback(e5) {
            this._executeHandlerFb = e5;
          }
          registerCsiHandler(e5, t5) {
            const i6 = this._identifier(e5);
            void 0 === this._csiHandlers[i6] && (this._csiHandlers[i6] = []);
            const s5 = this._csiHandlers[i6];
            return s5.push(t5), { dispose: () => {
              const e6 = s5.indexOf(t5);
              -1 !== e6 && s5.splice(e6, 1);
            } };
          }
          clearCsiHandler(e5) {
            this._csiHandlers[this._identifier(e5)] && delete this._csiHandlers[this._identifier(e5)];
          }
          setCsiHandlerFallback(e5) {
            this._csiHandlerFb = e5;
          }
          registerDcsHandler(e5, t5) {
            return this._dcsParser.registerHandler(this._identifier(e5), t5);
          }
          clearDcsHandler(e5) {
            this._dcsParser.clearHandler(this._identifier(e5));
          }
          setDcsHandlerFallback(e5) {
            this._dcsParser.setHandlerFallback(e5);
          }
          registerOscHandler(e5, t5) {
            return this._oscParser.registerHandler(e5, t5);
          }
          clearOscHandler(e5) {
            this._oscParser.clearHandler(e5);
          }
          setOscHandlerFallback(e5) {
            this._oscParser.setHandlerFallback(e5);
          }
          setErrorHandler(e5) {
            this._errorHandler = e5;
          }
          clearErrorHandler() {
            this._errorHandler = this._errorHandlerFb;
          }
          reset() {
            this.currentState = this.initialState, this._oscParser.reset(), this._dcsParser.reset(), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, 0 !== this._parseStack.state && (this._parseStack.state = 2, this._parseStack.handlers = []);
          }
          _preserveStack(e5, t5, i6, s5, r4) {
            this._parseStack.state = e5, this._parseStack.handlers = t5, this._parseStack.handlerPos = i6, this._parseStack.transition = s5, this._parseStack.chunkPos = r4;
          }
          parse(e5, t5, i6) {
            let s5, r4 = 0, n3 = 0, o4 = 0;
            if (this._parseStack.state) if (2 === this._parseStack.state) this._parseStack.state = 0, o4 = this._parseStack.chunkPos + 1;
            else {
              if (void 0 === i6 || 1 === this._parseStack.state) throw this._parseStack.state = 1, new Error("improper continuation due to previous async handler, giving up parsing");
              const t6 = this._parseStack.handlers;
              let n4 = this._parseStack.handlerPos - 1;
              switch (this._parseStack.state) {
                case 3:
                  if (false === i6 && n4 > -1) {
                    for (; n4 >= 0 && (s5 = t6[n4](this._params), true !== s5); n4--) if (s5 instanceof Promise) return this._parseStack.handlerPos = n4, s5;
                  }
                  this._parseStack.handlers = [];
                  break;
                case 4:
                  if (false === i6 && n4 > -1) {
                    for (; n4 >= 0 && (s5 = t6[n4](), true !== s5); n4--) if (s5 instanceof Promise) return this._parseStack.handlerPos = n4, s5;
                  }
                  this._parseStack.handlers = [];
                  break;
                case 6:
                  if (r4 = e5[this._parseStack.chunkPos], s5 = this._dcsParser.unhook(24 !== r4 && 26 !== r4, i6), s5) return s5;
                  27 === r4 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
                  break;
                case 5:
                  if (r4 = e5[this._parseStack.chunkPos], s5 = this._oscParser.end(24 !== r4 && 26 !== r4, i6), s5) return s5;
                  27 === r4 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
              }
              this._parseStack.state = 0, o4 = this._parseStack.chunkPos + 1, this.precedingJoinState = 0, this.currentState = 15 & this._parseStack.transition;
            }
            for (let i7 = o4; i7 < t5; ++i7) {
              switch (r4 = e5[i7], n3 = this._transitions.table[this.currentState << 8 | (r4 < 160 ? r4 : h3)], n3 >> 4) {
                case 2:
                  for (let s6 = i7 + 1; ; ++s6) {
                    if (s6 >= t5 || (r4 = e5[s6]) < 32 || r4 > 126 && r4 < h3) {
                      this._printHandler(e5, i7, s6), i7 = s6 - 1;
                      break;
                    }
                    if (++s6 >= t5 || (r4 = e5[s6]) < 32 || r4 > 126 && r4 < h3) {
                      this._printHandler(e5, i7, s6), i7 = s6 - 1;
                      break;
                    }
                    if (++s6 >= t5 || (r4 = e5[s6]) < 32 || r4 > 126 && r4 < h3) {
                      this._printHandler(e5, i7, s6), i7 = s6 - 1;
                      break;
                    }
                    if (++s6 >= t5 || (r4 = e5[s6]) < 32 || r4 > 126 && r4 < h3) {
                      this._printHandler(e5, i7, s6), i7 = s6 - 1;
                      break;
                    }
                  }
                  break;
                case 3:
                  this._executeHandlers[r4] ? this._executeHandlers[r4]() : this._executeHandlerFb(r4), this.precedingJoinState = 0;
                  break;
                case 0:
                  break;
                case 1:
                  if (this._errorHandler({ position: i7, code: r4, currentState: this.currentState, collect: this._collect, params: this._params, abort: false }).abort) return;
                  break;
                case 7:
                  const o5 = this._csiHandlers[this._collect << 8 | r4];
                  let a4 = o5 ? o5.length - 1 : -1;
                  for (; a4 >= 0 && (s5 = o5[a4](this._params), true !== s5); a4--) if (s5 instanceof Promise) return this._preserveStack(3, o5, a4, n3, i7), s5;
                  a4 < 0 && this._csiHandlerFb(this._collect << 8 | r4, this._params), this.precedingJoinState = 0;
                  break;
                case 8:
                  do {
                    switch (r4) {
                      case 59:
                        this._params.addParam(0);
                        break;
                      case 58:
                        this._params.addSubParam(-1);
                        break;
                      default:
                        this._params.addDigit(r4 - 48);
                    }
                  } while (++i7 < t5 && (r4 = e5[i7]) > 47 && r4 < 60);
                  i7--;
                  break;
                case 9:
                  this._collect <<= 8, this._collect |= r4;
                  break;
                case 10:
                  const c4 = this._escHandlers[this._collect << 8 | r4];
                  let l3 = c4 ? c4.length - 1 : -1;
                  for (; l3 >= 0 && (s5 = c4[l3](), true !== s5); l3--) if (s5 instanceof Promise) return this._preserveStack(4, c4, l3, n3, i7), s5;
                  l3 < 0 && this._escHandlerFb(this._collect << 8 | r4), this.precedingJoinState = 0;
                  break;
                case 11:
                  this._params.reset(), this._params.addParam(0), this._collect = 0;
                  break;
                case 12:
                  this._dcsParser.hook(this._collect << 8 | r4, this._params);
                  break;
                case 13:
                  for (let s6 = i7 + 1; ; ++s6) if (s6 >= t5 || 24 === (r4 = e5[s6]) || 26 === r4 || 27 === r4 || r4 > 127 && r4 < h3) {
                    this._dcsParser.put(e5, i7, s6), i7 = s6 - 1;
                    break;
                  }
                  break;
                case 14:
                  if (s5 = this._dcsParser.unhook(24 !== r4 && 26 !== r4), s5) return this._preserveStack(6, [], 0, n3, i7), s5;
                  27 === r4 && (n3 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
                  break;
                case 4:
                  this._oscParser.start();
                  break;
                case 5:
                  for (let s6 = i7 + 1; ; s6++) if (s6 >= t5 || (r4 = e5[s6]) < 32 || r4 > 127 && r4 < h3) {
                    this._oscParser.put(e5, i7, s6), i7 = s6 - 1;
                    break;
                  }
                  break;
                case 6:
                  if (s5 = this._oscParser.end(24 !== r4 && 26 !== r4), s5) return this._preserveStack(5, [], 0, n3, i7), s5;
                  27 === r4 && (n3 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
              }
              this.currentState = 15 & n3;
            }
          }
        }
        t4.EscapeSequenceParser = c3;
      }, 6242: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.OscHandler = t4.OscParser = void 0;
        const s4 = i5(5770), r3 = i5(482), n2 = [];
        t4.OscParser = class {
          constructor() {
            this._state = 0, this._active = n2, this._id = -1, this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._stack = { paused: false, loopPosition: 0, fallThrough: false };
          }
          registerHandler(e5, t5) {
            void 0 === this._handlers[e5] && (this._handlers[e5] = []);
            const i6 = this._handlers[e5];
            return i6.push(t5), { dispose: () => {
              const e6 = i6.indexOf(t5);
              -1 !== e6 && i6.splice(e6, 1);
            } };
          }
          clearHandler(e5) {
            this._handlers[e5] && delete this._handlers[e5];
          }
          setHandlerFallback(e5) {
            this._handlerFb = e5;
          }
          dispose() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._active = n2;
          }
          reset() {
            if (2 === this._state) for (let e5 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e5 >= 0; --e5) this._active[e5].end(false);
            this._stack.paused = false, this._active = n2, this._id = -1, this._state = 0;
          }
          _start() {
            if (this._active = this._handlers[this._id] || n2, this._active.length) for (let e5 = this._active.length - 1; e5 >= 0; e5--) this._active[e5].start();
            else this._handlerFb(this._id, "START");
          }
          _put(e5, t5, i6) {
            if (this._active.length) for (let s5 = this._active.length - 1; s5 >= 0; s5--) this._active[s5].put(e5, t5, i6);
            else this._handlerFb(this._id, "PUT", (0, r3.utf32ToString)(e5, t5, i6));
          }
          start() {
            this.reset(), this._state = 1;
          }
          put(e5, t5, i6) {
            if (3 !== this._state) {
              if (1 === this._state) for (; t5 < i6; ) {
                const i7 = e5[t5++];
                if (59 === i7) {
                  this._state = 2, this._start();
                  break;
                }
                if (i7 < 48 || 57 < i7) return void (this._state = 3);
                -1 === this._id && (this._id = 0), this._id = 10 * this._id + i7 - 48;
              }
              2 === this._state && i6 - t5 > 0 && this._put(e5, t5, i6);
            }
          }
          end(e5, t5 = true) {
            if (0 !== this._state) {
              if (3 !== this._state) if (1 === this._state && this._start(), this._active.length) {
                let i6 = false, s5 = this._active.length - 1, r4 = false;
                if (this._stack.paused && (s5 = this._stack.loopPosition - 1, i6 = t5, r4 = this._stack.fallThrough, this._stack.paused = false), !r4 && false === i6) {
                  for (; s5 >= 0 && (i6 = this._active[s5].end(e5), true !== i6); s5--) if (i6 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s5, this._stack.fallThrough = false, i6;
                  s5--;
                }
                for (; s5 >= 0; s5--) if (i6 = this._active[s5].end(false), i6 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s5, this._stack.fallThrough = true, i6;
              } else this._handlerFb(this._id, "END", e5);
              this._active = n2, this._id = -1, this._state = 0;
            }
          }
        }, t4.OscHandler = class {
          constructor(e5) {
            this._handler = e5, this._data = "", this._hitLimit = false;
          }
          start() {
            this._data = "", this._hitLimit = false;
          }
          put(e5, t5, i6) {
            this._hitLimit || (this._data += (0, r3.utf32ToString)(e5, t5, i6), this._data.length > s4.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = true));
          }
          end(e5) {
            let t5 = false;
            if (this._hitLimit) t5 = false;
            else if (e5 && (t5 = this._handler(this._data), t5 instanceof Promise)) return t5.then((e6) => (this._data = "", this._hitLimit = false, e6));
            return this._data = "", this._hitLimit = false, t5;
          }
        };
      }, 8742: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.Params = void 0;
        const i5 = 2147483647;
        class s4 {
          static fromArray(e5) {
            const t5 = new s4();
            if (!e5.length) return t5;
            for (let i6 = Array.isArray(e5[0]) ? 1 : 0; i6 < e5.length; ++i6) {
              const s5 = e5[i6];
              if (Array.isArray(s5)) for (let e6 = 0; e6 < s5.length; ++e6) t5.addSubParam(s5[e6]);
              else t5.addParam(s5);
            }
            return t5;
          }
          constructor(e5 = 32, t5 = 32) {
            if (this.maxLength = e5, this.maxSubParamsLength = t5, t5 > 256) throw new Error("maxSubParamsLength must not be greater than 256");
            this.params = new Int32Array(e5), this.length = 0, this._subParams = new Int32Array(t5), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(e5), this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
          }
          clone() {
            const e5 = new s4(this.maxLength, this.maxSubParamsLength);
            return e5.params.set(this.params), e5.length = this.length, e5._subParams.set(this._subParams), e5._subParamsLength = this._subParamsLength, e5._subParamsIdx.set(this._subParamsIdx), e5._rejectDigits = this._rejectDigits, e5._rejectSubDigits = this._rejectSubDigits, e5._digitIsSub = this._digitIsSub, e5;
          }
          toArray() {
            const e5 = [];
            for (let t5 = 0; t5 < this.length; ++t5) {
              e5.push(this.params[t5]);
              const i6 = this._subParamsIdx[t5] >> 8, s5 = 255 & this._subParamsIdx[t5];
              s5 - i6 > 0 && e5.push(Array.prototype.slice.call(this._subParams, i6, s5));
            }
            return e5;
          }
          reset() {
            this.length = 0, this._subParamsLength = 0, this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
          }
          addParam(e5) {
            if (this._digitIsSub = false, this.length >= this.maxLength) this._rejectDigits = true;
            else {
              if (e5 < -1) throw new Error("values lesser than -1 are not allowed");
              this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = e5 > i5 ? i5 : e5;
            }
          }
          addSubParam(e5) {
            if (this._digitIsSub = true, this.length) if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength) this._rejectSubDigits = true;
            else {
              if (e5 < -1) throw new Error("values lesser than -1 are not allowed");
              this._subParams[this._subParamsLength++] = e5 > i5 ? i5 : e5, this._subParamsIdx[this.length - 1]++;
            }
          }
          hasSubParams(e5) {
            return (255 & this._subParamsIdx[e5]) - (this._subParamsIdx[e5] >> 8) > 0;
          }
          getSubParams(e5) {
            const t5 = this._subParamsIdx[e5] >> 8, i6 = 255 & this._subParamsIdx[e5];
            return i6 - t5 > 0 ? this._subParams.subarray(t5, i6) : null;
          }
          getSubParamsAll() {
            const e5 = {};
            for (let t5 = 0; t5 < this.length; ++t5) {
              const i6 = this._subParamsIdx[t5] >> 8, s5 = 255 & this._subParamsIdx[t5];
              s5 - i6 > 0 && (e5[t5] = this._subParams.slice(i6, s5));
            }
            return e5;
          }
          addDigit(e5) {
            let t5;
            if (this._rejectDigits || !(t5 = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits) return;
            const s5 = this._digitIsSub ? this._subParams : this.params, r3 = s5[t5 - 1];
            s5[t5 - 1] = ~r3 ? Math.min(10 * r3 + e5, i5) : e5;
          }
        }
        t4.Params = s4;
      }, 5741: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.AddonManager = void 0, t4.AddonManager = class {
          constructor() {
            this._addons = [];
          }
          dispose() {
            for (let e5 = this._addons.length - 1; e5 >= 0; e5--) this._addons[e5].instance.dispose();
          }
          loadAddon(e5, t5) {
            const i5 = { instance: t5, dispose: t5.dispose, isDisposed: false };
            this._addons.push(i5), t5.dispose = () => this._wrappedAddonDispose(i5), t5.activate(e5);
          }
          _wrappedAddonDispose(e5) {
            if (e5.isDisposed) return;
            let t5 = -1;
            for (let i5 = 0; i5 < this._addons.length; i5++) if (this._addons[i5] === e5) {
              t5 = i5;
              break;
            }
            if (-1 === t5) throw new Error("Could not dispose an addon that has not been loaded");
            e5.isDisposed = true, e5.dispose.apply(e5.instance), this._addons.splice(t5, 1);
          }
        };
      }, 8771: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.BufferApiView = void 0;
        const s4 = i5(3785), r3 = i5(511);
        t4.BufferApiView = class {
          constructor(e5, t5) {
            this._buffer = e5, this.type = t5;
          }
          init(e5) {
            return this._buffer = e5, this;
          }
          get cursorY() {
            return this._buffer.y;
          }
          get cursorX() {
            return this._buffer.x;
          }
          get viewportY() {
            return this._buffer.ydisp;
          }
          get baseY() {
            return this._buffer.ybase;
          }
          get length() {
            return this._buffer.lines.length;
          }
          getLine(e5) {
            const t5 = this._buffer.lines.get(e5);
            if (t5) return new s4.BufferLineApiView(t5);
          }
          getNullCell() {
            return new r3.CellData();
          }
        };
      }, 3785: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.BufferLineApiView = void 0;
        const s4 = i5(511);
        t4.BufferLineApiView = class {
          constructor(e5) {
            this._line = e5;
          }
          get isWrapped() {
            return this._line.isWrapped;
          }
          get length() {
            return this._line.length;
          }
          getCell(e5, t5) {
            if (!(e5 < 0 || e5 >= this._line.length)) return t5 ? (this._line.loadCell(e5, t5), t5) : this._line.loadCell(e5, new s4.CellData());
          }
          translateToString(e5, t5, i6) {
            return this._line.translateToString(e5, t5, i6);
          }
        };
      }, 8285: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.BufferNamespaceApi = void 0;
        const s4 = i5(8771), r3 = i5(8460), n2 = i5(844);
        class o3 extends n2.Disposable {
          constructor(e5) {
            super(), this._core = e5, this._onBufferChange = this.register(new r3.EventEmitter()), this.onBufferChange = this._onBufferChange.event, this._normal = new s4.BufferApiView(this._core.buffers.normal, "normal"), this._alternate = new s4.BufferApiView(this._core.buffers.alt, "alternate"), this._core.buffers.onBufferActivate(() => this._onBufferChange.fire(this.active));
          }
          get active() {
            if (this._core.buffers.active === this._core.buffers.normal) return this.normal;
            if (this._core.buffers.active === this._core.buffers.alt) return this.alternate;
            throw new Error("Active buffer is neither normal nor alternate");
          }
          get normal() {
            return this._normal.init(this._core.buffers.normal);
          }
          get alternate() {
            return this._alternate.init(this._core.buffers.alt);
          }
        }
        t4.BufferNamespaceApi = o3;
      }, 7975: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.ParserApi = void 0, t4.ParserApi = class {
          constructor(e5) {
            this._core = e5;
          }
          registerCsiHandler(e5, t5) {
            return this._core.registerCsiHandler(e5, (e6) => t5(e6.toArray()));
          }
          addCsiHandler(e5, t5) {
            return this.registerCsiHandler(e5, t5);
          }
          registerDcsHandler(e5, t5) {
            return this._core.registerDcsHandler(e5, (e6, i5) => t5(e6, i5.toArray()));
          }
          addDcsHandler(e5, t5) {
            return this.registerDcsHandler(e5, t5);
          }
          registerEscHandler(e5, t5) {
            return this._core.registerEscHandler(e5, t5);
          }
          addEscHandler(e5, t5) {
            return this.registerEscHandler(e5, t5);
          }
          registerOscHandler(e5, t5) {
            return this._core.registerOscHandler(e5, t5);
          }
          addOscHandler(e5, t5) {
            return this.registerOscHandler(e5, t5);
          }
        };
      }, 7090: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.UnicodeApi = void 0, t4.UnicodeApi = class {
          constructor(e5) {
            this._core = e5;
          }
          register(e5) {
            this._core.unicodeService.register(e5);
          }
          get versions() {
            return this._core.unicodeService.versions;
          }
          get activeVersion() {
            return this._core.unicodeService.activeVersion;
          }
          set activeVersion(e5) {
            this._core.unicodeService.activeVersion = e5;
          }
        };
      }, 744: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.BufferService = t4.MINIMUM_ROWS = t4.MINIMUM_COLS = void 0;
        const n2 = i5(8460), o3 = i5(844), a3 = i5(5295), h3 = i5(2585);
        t4.MINIMUM_COLS = 2, t4.MINIMUM_ROWS = 1;
        let c3 = t4.BufferService = class extends o3.Disposable {
          get buffer() {
            return this.buffers.active;
          }
          constructor(e5) {
            super(), this.isUserScrolling = false, this._onResize = this.register(new n2.EventEmitter()), this.onResize = this._onResize.event, this._onScroll = this.register(new n2.EventEmitter()), this.onScroll = this._onScroll.event, this.cols = Math.max(e5.rawOptions.cols || 0, t4.MINIMUM_COLS), this.rows = Math.max(e5.rawOptions.rows || 0, t4.MINIMUM_ROWS), this.buffers = this.register(new a3.BufferSet(e5, this));
          }
          resize(e5, t5) {
            this.cols = e5, this.rows = t5, this.buffers.resize(e5, t5), this._onResize.fire({ cols: e5, rows: t5 });
          }
          reset() {
            this.buffers.reset(), this.isUserScrolling = false;
          }
          scroll(e5, t5 = false) {
            const i6 = this.buffer;
            let s5;
            s5 = this._cachedBlankLine, s5 && s5.length === this.cols && s5.getFg(0) === e5.fg && s5.getBg(0) === e5.bg || (s5 = i6.getBlankLine(e5, t5), this._cachedBlankLine = s5), s5.isWrapped = t5;
            const r4 = i6.ybase + i6.scrollTop, n3 = i6.ybase + i6.scrollBottom;
            if (0 === i6.scrollTop) {
              const e6 = i6.lines.isFull;
              n3 === i6.lines.length - 1 ? e6 ? i6.lines.recycle().copyFrom(s5) : i6.lines.push(s5.clone()) : i6.lines.splice(n3 + 1, 0, s5.clone()), e6 ? this.isUserScrolling && (i6.ydisp = Math.max(i6.ydisp - 1, 0)) : (i6.ybase++, this.isUserScrolling || i6.ydisp++);
            } else {
              const e6 = n3 - r4 + 1;
              i6.lines.shiftElements(r4 + 1, e6 - 1, -1), i6.lines.set(n3, s5.clone());
            }
            this.isUserScrolling || (i6.ydisp = i6.ybase), this._onScroll.fire(i6.ydisp);
          }
          scrollLines(e5, t5, i6) {
            const s5 = this.buffer;
            if (e5 < 0) {
              if (0 === s5.ydisp) return;
              this.isUserScrolling = true;
            } else e5 + s5.ydisp >= s5.ybase && (this.isUserScrolling = false);
            const r4 = s5.ydisp;
            s5.ydisp = Math.max(Math.min(s5.ydisp + e5, s5.ybase), 0), r4 !== s5.ydisp && (t5 || this._onScroll.fire(s5.ydisp));
          }
        };
        t4.BufferService = c3 = s4([r3(0, h3.IOptionsService)], c3);
      }, 7994: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CharsetService = void 0, t4.CharsetService = class {
          constructor() {
            this.glevel = 0, this._charsets = [];
          }
          reset() {
            this.charset = void 0, this._charsets = [], this.glevel = 0;
          }
          setgLevel(e5) {
            this.glevel = e5, this.charset = this._charsets[e5];
          }
          setgCharset(e5, t5) {
            this._charsets[e5] = t5, this.glevel === e5 && (this.charset = t5);
          }
        };
      }, 1753: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CoreMouseService = void 0;
        const n2 = i5(2585), o3 = i5(8460), a3 = i5(844), h3 = { NONE: { events: 0, restrict: () => false }, X10: { events: 1, restrict: (e5) => 4 !== e5.button && 1 === e5.action && (e5.ctrl = false, e5.alt = false, e5.shift = false, true) }, VT200: { events: 19, restrict: (e5) => 32 !== e5.action }, DRAG: { events: 23, restrict: (e5) => 32 !== e5.action || 3 !== e5.button }, ANY: { events: 31, restrict: (e5) => true } };
        function c3(e5, t5) {
          let i6 = (e5.ctrl ? 16 : 0) | (e5.shift ? 4 : 0) | (e5.alt ? 8 : 0);
          return 4 === e5.button ? (i6 |= 64, i6 |= e5.action) : (i6 |= 3 & e5.button, 4 & e5.button && (i6 |= 64), 8 & e5.button && (i6 |= 128), 32 === e5.action ? i6 |= 32 : 0 !== e5.action || t5 || (i6 |= 3)), i6;
        }
        const l3 = String.fromCharCode, d3 = { DEFAULT: (e5) => {
          const t5 = [c3(e5, false) + 32, e5.col + 32, e5.row + 32];
          return t5[0] > 255 || t5[1] > 255 || t5[2] > 255 ? "" : `\x1B[M${l3(t5[0])}${l3(t5[1])}${l3(t5[2])}`;
        }, SGR: (e5) => {
          const t5 = 0 === e5.action && 4 !== e5.button ? "m" : "M";
          return `\x1B[<${c3(e5, true)};${e5.col};${e5.row}${t5}`;
        }, SGR_PIXELS: (e5) => {
          const t5 = 0 === e5.action && 4 !== e5.button ? "m" : "M";
          return `\x1B[<${c3(e5, true)};${e5.x};${e5.y}${t5}`;
        } };
        let _2 = t4.CoreMouseService = class extends a3.Disposable {
          constructor(e5, t5) {
            super(), this._bufferService = e5, this._coreService = t5, this._protocols = {}, this._encodings = {}, this._activeProtocol = "", this._activeEncoding = "", this._lastEvent = null, this._onProtocolChange = this.register(new o3.EventEmitter()), this.onProtocolChange = this._onProtocolChange.event;
            for (const e6 of Object.keys(h3)) this.addProtocol(e6, h3[e6]);
            for (const e6 of Object.keys(d3)) this.addEncoding(e6, d3[e6]);
            this.reset();
          }
          addProtocol(e5, t5) {
            this._protocols[e5] = t5;
          }
          addEncoding(e5, t5) {
            this._encodings[e5] = t5;
          }
          get activeProtocol() {
            return this._activeProtocol;
          }
          get areMouseEventsActive() {
            return 0 !== this._protocols[this._activeProtocol].events;
          }
          set activeProtocol(e5) {
            if (!this._protocols[e5]) throw new Error(`unknown protocol "${e5}"`);
            this._activeProtocol = e5, this._onProtocolChange.fire(this._protocols[e5].events);
          }
          get activeEncoding() {
            return this._activeEncoding;
          }
          set activeEncoding(e5) {
            if (!this._encodings[e5]) throw new Error(`unknown encoding "${e5}"`);
            this._activeEncoding = e5;
          }
          reset() {
            this.activeProtocol = "NONE", this.activeEncoding = "DEFAULT", this._lastEvent = null;
          }
          triggerMouseEvent(e5) {
            if (e5.col < 0 || e5.col >= this._bufferService.cols || e5.row < 0 || e5.row >= this._bufferService.rows) return false;
            if (4 === e5.button && 32 === e5.action) return false;
            if (3 === e5.button && 32 !== e5.action) return false;
            if (4 !== e5.button && (2 === e5.action || 3 === e5.action)) return false;
            if (e5.col++, e5.row++, 32 === e5.action && this._lastEvent && this._equalEvents(this._lastEvent, e5, "SGR_PIXELS" === this._activeEncoding)) return false;
            if (!this._protocols[this._activeProtocol].restrict(e5)) return false;
            const t5 = this._encodings[this._activeEncoding](e5);
            return t5 && ("DEFAULT" === this._activeEncoding ? this._coreService.triggerBinaryEvent(t5) : this._coreService.triggerDataEvent(t5, true)), this._lastEvent = e5, true;
          }
          explainEvents(e5) {
            return { down: !!(1 & e5), up: !!(2 & e5), drag: !!(4 & e5), move: !!(8 & e5), wheel: !!(16 & e5) };
          }
          _equalEvents(e5, t5, i6) {
            if (i6) {
              if (e5.x !== t5.x) return false;
              if (e5.y !== t5.y) return false;
            } else {
              if (e5.col !== t5.col) return false;
              if (e5.row !== t5.row) return false;
            }
            return e5.button === t5.button && e5.action === t5.action && e5.ctrl === t5.ctrl && e5.alt === t5.alt && e5.shift === t5.shift;
          }
        };
        t4.CoreMouseService = _2 = s4([r3(0, n2.IBufferService), r3(1, n2.ICoreService)], _2);
      }, 6975: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.CoreService = void 0;
        const n2 = i5(1439), o3 = i5(8460), a3 = i5(844), h3 = i5(2585), c3 = Object.freeze({ insertMode: false }), l3 = Object.freeze({ applicationCursorKeys: false, applicationKeypad: false, bracketedPasteMode: false, origin: false, reverseWraparound: false, sendFocus: false, wraparound: true });
        let d3 = t4.CoreService = class extends a3.Disposable {
          constructor(e5, t5, i6) {
            super(), this._bufferService = e5, this._logService = t5, this._optionsService = i6, this.isCursorInitialized = false, this.isCursorHidden = false, this._onData = this.register(new o3.EventEmitter()), this.onData = this._onData.event, this._onUserInput = this.register(new o3.EventEmitter()), this.onUserInput = this._onUserInput.event, this._onBinary = this.register(new o3.EventEmitter()), this.onBinary = this._onBinary.event, this._onRequestScrollToBottom = this.register(new o3.EventEmitter()), this.onRequestScrollToBottom = this._onRequestScrollToBottom.event, this.modes = (0, n2.clone)(c3), this.decPrivateModes = (0, n2.clone)(l3);
          }
          reset() {
            this.modes = (0, n2.clone)(c3), this.decPrivateModes = (0, n2.clone)(l3);
          }
          triggerDataEvent(e5, t5 = false) {
            if (this._optionsService.rawOptions.disableStdin) return;
            const i6 = this._bufferService.buffer;
            t5 && this._optionsService.rawOptions.scrollOnUserInput && i6.ybase !== i6.ydisp && this._onRequestScrollToBottom.fire(), t5 && this._onUserInput.fire(), this._logService.debug(`sending data "${e5}"`, () => e5.split("").map((e6) => e6.charCodeAt(0))), this._onData.fire(e5);
          }
          triggerBinaryEvent(e5) {
            this._optionsService.rawOptions.disableStdin || (this._logService.debug(`sending binary "${e5}"`, () => e5.split("").map((e6) => e6.charCodeAt(0))), this._onBinary.fire(e5));
          }
        };
        t4.CoreService = d3 = s4([r3(0, h3.IBufferService), r3(1, h3.ILogService), r3(2, h3.IOptionsService)], d3);
      }, 9074: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.DecorationService = void 0;
        const s4 = i5(8055), r3 = i5(8460), n2 = i5(844), o3 = i5(6106);
        let a3 = 0, h3 = 0;
        class c3 extends n2.Disposable {
          get decorations() {
            return this._decorations.values();
          }
          constructor() {
            super(), this._decorations = new o3.SortedList((e5) => e5?.marker.line), this._onDecorationRegistered = this.register(new r3.EventEmitter()), this.onDecorationRegistered = this._onDecorationRegistered.event, this._onDecorationRemoved = this.register(new r3.EventEmitter()), this.onDecorationRemoved = this._onDecorationRemoved.event, this.register((0, n2.toDisposable)(() => this.reset()));
          }
          registerDecoration(e5) {
            if (e5.marker.isDisposed) return;
            const t5 = new l3(e5);
            if (t5) {
              const e6 = t5.marker.onDispose(() => t5.dispose());
              t5.onDispose(() => {
                t5 && (this._decorations.delete(t5) && this._onDecorationRemoved.fire(t5), e6.dispose());
              }), this._decorations.insert(t5), this._onDecorationRegistered.fire(t5);
            }
            return t5;
          }
          reset() {
            for (const e5 of this._decorations.values()) e5.dispose();
            this._decorations.clear();
          }
          *getDecorationsAtCell(e5, t5, i6) {
            let s5 = 0, r4 = 0;
            for (const n3 of this._decorations.getKeyIterator(t5)) s5 = n3.options.x ?? 0, r4 = s5 + (n3.options.width ?? 1), e5 >= s5 && e5 < r4 && (!i6 || (n3.options.layer ?? "bottom") === i6) && (yield n3);
          }
          forEachDecorationAtCell(e5, t5, i6, s5) {
            this._decorations.forEachByKey(t5, (t6) => {
              a3 = t6.options.x ?? 0, h3 = a3 + (t6.options.width ?? 1), e5 >= a3 && e5 < h3 && (!i6 || (t6.options.layer ?? "bottom") === i6) && s5(t6);
            });
          }
        }
        t4.DecorationService = c3;
        class l3 extends n2.Disposable {
          get isDisposed() {
            return this._isDisposed;
          }
          get backgroundColorRGB() {
            return null === this._cachedBg && (this.options.backgroundColor ? this._cachedBg = s4.css.toColor(this.options.backgroundColor) : this._cachedBg = void 0), this._cachedBg;
          }
          get foregroundColorRGB() {
            return null === this._cachedFg && (this.options.foregroundColor ? this._cachedFg = s4.css.toColor(this.options.foregroundColor) : this._cachedFg = void 0), this._cachedFg;
          }
          constructor(e5) {
            super(), this.options = e5, this.onRenderEmitter = this.register(new r3.EventEmitter()), this.onRender = this.onRenderEmitter.event, this._onDispose = this.register(new r3.EventEmitter()), this.onDispose = this._onDispose.event, this._cachedBg = null, this._cachedFg = null, this.marker = e5.marker, this.options.overviewRulerOptions && !this.options.overviewRulerOptions.position && (this.options.overviewRulerOptions.position = "full");
          }
          dispose() {
            this._onDispose.fire(), super.dispose();
          }
        }
      }, 4348: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.InstantiationService = t4.ServiceCollection = void 0;
        const s4 = i5(2585), r3 = i5(8343);
        class n2 {
          constructor(...e5) {
            this._entries = /* @__PURE__ */ new Map();
            for (const [t5, i6] of e5) this.set(t5, i6);
          }
          set(e5, t5) {
            const i6 = this._entries.get(e5);
            return this._entries.set(e5, t5), i6;
          }
          forEach(e5) {
            for (const [t5, i6] of this._entries.entries()) e5(t5, i6);
          }
          has(e5) {
            return this._entries.has(e5);
          }
          get(e5) {
            return this._entries.get(e5);
          }
        }
        t4.ServiceCollection = n2, t4.InstantiationService = class {
          constructor() {
            this._services = new n2(), this._services.set(s4.IInstantiationService, this);
          }
          setService(e5, t5) {
            this._services.set(e5, t5);
          }
          getService(e5) {
            return this._services.get(e5);
          }
          createInstance(e5, ...t5) {
            const i6 = (0, r3.getServiceDependencies)(e5).sort((e6, t6) => e6.index - t6.index), s5 = [];
            for (const t6 of i6) {
              const i7 = this._services.get(t6.id);
              if (!i7) throw new Error(`[createInstance] ${e5.name} depends on UNKNOWN service ${t6.id}.`);
              s5.push(i7);
            }
            const n3 = i6.length > 0 ? i6[0].index : t5.length;
            if (t5.length !== n3) throw new Error(`[createInstance] First service dependency of ${e5.name} at position ${n3 + 1} conflicts with ${t5.length} static arguments`);
            return new e5(...[...t5, ...s5]);
          }
        };
      }, 7866: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a4 = e5.length - 1; a4 >= 0; a4--) (r4 = e5[a4]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.traceCall = t4.setTraceLogger = t4.LogService = void 0;
        const n2 = i5(844), o3 = i5(2585), a3 = { trace: o3.LogLevelEnum.TRACE, debug: o3.LogLevelEnum.DEBUG, info: o3.LogLevelEnum.INFO, warn: o3.LogLevelEnum.WARN, error: o3.LogLevelEnum.ERROR, off: o3.LogLevelEnum.OFF };
        let h3, c3 = t4.LogService = class extends n2.Disposable {
          get logLevel() {
            return this._logLevel;
          }
          constructor(e5) {
            super(), this._optionsService = e5, this._logLevel = o3.LogLevelEnum.OFF, this._updateLogLevel(), this.register(this._optionsService.onSpecificOptionChange("logLevel", () => this._updateLogLevel())), h3 = this;
          }
          _updateLogLevel() {
            this._logLevel = a3[this._optionsService.rawOptions.logLevel];
          }
          _evalLazyOptionalParams(e5) {
            for (let t5 = 0; t5 < e5.length; t5++) "function" == typeof e5[t5] && (e5[t5] = e5[t5]());
          }
          _log(e5, t5, i6) {
            this._evalLazyOptionalParams(i6), e5.call(console, (this._optionsService.options.logger ? "" : "xterm.js: ") + t5, ...i6);
          }
          trace(e5, ...t5) {
            this._logLevel <= o3.LogLevelEnum.TRACE && this._log(this._optionsService.options.logger?.trace.bind(this._optionsService.options.logger) ?? console.log, e5, t5);
          }
          debug(e5, ...t5) {
            this._logLevel <= o3.LogLevelEnum.DEBUG && this._log(this._optionsService.options.logger?.debug.bind(this._optionsService.options.logger) ?? console.log, e5, t5);
          }
          info(e5, ...t5) {
            this._logLevel <= o3.LogLevelEnum.INFO && this._log(this._optionsService.options.logger?.info.bind(this._optionsService.options.logger) ?? console.info, e5, t5);
          }
          warn(e5, ...t5) {
            this._logLevel <= o3.LogLevelEnum.WARN && this._log(this._optionsService.options.logger?.warn.bind(this._optionsService.options.logger) ?? console.warn, e5, t5);
          }
          error(e5, ...t5) {
            this._logLevel <= o3.LogLevelEnum.ERROR && this._log(this._optionsService.options.logger?.error.bind(this._optionsService.options.logger) ?? console.error, e5, t5);
          }
        };
        t4.LogService = c3 = s4([r3(0, o3.IOptionsService)], c3), t4.setTraceLogger = function(e5) {
          h3 = e5;
        }, t4.traceCall = function(e5, t5, i6) {
          if ("function" != typeof i6.value) throw new Error("not supported");
          const s5 = i6.value;
          i6.value = function(...e6) {
            if (h3.logLevel !== o3.LogLevelEnum.TRACE) return s5.apply(this, e6);
            h3.trace(`GlyphRenderer#${s5.name}(${e6.map((e7) => JSON.stringify(e7)).join(", ")})`);
            const t6 = s5.apply(this, e6);
            return h3.trace(`GlyphRenderer#${s5.name} return`, t6), t6;
          };
        };
      }, 7302: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.OptionsService = t4.DEFAULT_OPTIONS = void 0;
        const s4 = i5(8460), r3 = i5(844), n2 = i5(6114);
        t4.DEFAULT_OPTIONS = { cols: 80, rows: 24, cursorBlink: false, cursorStyle: "block", cursorWidth: 1, cursorInactiveStyle: "outline", customGlyphs: true, drawBoldTextInBrightColors: true, documentOverride: null, fastScrollModifier: "alt", fastScrollSensitivity: 5, fontFamily: "courier-new, courier, monospace", fontSize: 15, fontWeight: "normal", fontWeightBold: "bold", ignoreBracketedPasteMode: false, lineHeight: 1, letterSpacing: 0, linkHandler: null, logLevel: "info", logger: null, scrollback: 1e3, scrollOnUserInput: true, scrollSensitivity: 1, screenReaderMode: false, smoothScrollDuration: 0, macOptionIsMeta: false, macOptionClickForcesSelection: false, minimumContrastRatio: 1, disableStdin: false, allowProposedApi: false, allowTransparency: false, tabStopWidth: 8, theme: {}, rescaleOverlappingGlyphs: false, rightClickSelectsWord: n2.isMac, windowOptions: {}, windowsMode: false, windowsPty: {}, wordSeparator: " ()[]{}',\"`", altClickMovesCursor: true, convertEol: false, termName: "xterm", cancelEvents: false, overviewRulerWidth: 0 };
        const o3 = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
        class a3 extends r3.Disposable {
          constructor(e5) {
            super(), this._onOptionChange = this.register(new s4.EventEmitter()), this.onOptionChange = this._onOptionChange.event;
            const i6 = { ...t4.DEFAULT_OPTIONS };
            for (const t5 in e5) if (t5 in i6) try {
              const s5 = e5[t5];
              i6[t5] = this._sanitizeAndValidateOption(t5, s5);
            } catch (e6) {
              console.error(e6);
            }
            this.rawOptions = i6, this.options = { ...i6 }, this._setupOptions(), this.register((0, r3.toDisposable)(() => {
              this.rawOptions.linkHandler = null, this.rawOptions.documentOverride = null;
            }));
          }
          onSpecificOptionChange(e5, t5) {
            return this.onOptionChange((i6) => {
              i6 === e5 && t5(this.rawOptions[e5]);
            });
          }
          onMultipleOptionChange(e5, t5) {
            return this.onOptionChange((i6) => {
              -1 !== e5.indexOf(i6) && t5();
            });
          }
          _setupOptions() {
            const e5 = (e6) => {
              if (!(e6 in t4.DEFAULT_OPTIONS)) throw new Error(`No option with key "${e6}"`);
              return this.rawOptions[e6];
            }, i6 = (e6, i7) => {
              if (!(e6 in t4.DEFAULT_OPTIONS)) throw new Error(`No option with key "${e6}"`);
              i7 = this._sanitizeAndValidateOption(e6, i7), this.rawOptions[e6] !== i7 && (this.rawOptions[e6] = i7, this._onOptionChange.fire(e6));
            };
            for (const t5 in this.rawOptions) {
              const s5 = { get: e5.bind(this, t5), set: i6.bind(this, t5) };
              Object.defineProperty(this.options, t5, s5);
            }
          }
          _sanitizeAndValidateOption(e5, i6) {
            switch (e5) {
              case "cursorStyle":
                if (i6 || (i6 = t4.DEFAULT_OPTIONS[e5]), !/* @__PURE__ */ function(e6) {
                  return "block" === e6 || "underline" === e6 || "bar" === e6;
                }(i6)) throw new Error(`"${i6}" is not a valid value for ${e5}`);
                break;
              case "wordSeparator":
                i6 || (i6 = t4.DEFAULT_OPTIONS[e5]);
                break;
              case "fontWeight":
              case "fontWeightBold":
                if ("number" == typeof i6 && 1 <= i6 && i6 <= 1e3) break;
                i6 = o3.includes(i6) ? i6 : t4.DEFAULT_OPTIONS[e5];
                break;
              case "cursorWidth":
                i6 = Math.floor(i6);
              case "lineHeight":
              case "tabStopWidth":
                if (i6 < 1) throw new Error(`${e5} cannot be less than 1, value: ${i6}`);
                break;
              case "minimumContrastRatio":
                i6 = Math.max(1, Math.min(21, Math.round(10 * i6) / 10));
                break;
              case "scrollback":
                if ((i6 = Math.min(i6, 4294967295)) < 0) throw new Error(`${e5} cannot be less than 0, value: ${i6}`);
                break;
              case "fastScrollSensitivity":
              case "scrollSensitivity":
                if (i6 <= 0) throw new Error(`${e5} cannot be less than or equal to 0, value: ${i6}`);
                break;
              case "rows":
              case "cols":
                if (!i6 && 0 !== i6) throw new Error(`${e5} must be numeric, value: ${i6}`);
                break;
              case "windowsPty":
                i6 = i6 ?? {};
            }
            return i6;
          }
        }
        t4.OptionsService = a3;
      }, 2660: function(e4, t4, i5) {
        var s4 = this && this.__decorate || function(e5, t5, i6, s5) {
          var r4, n3 = arguments.length, o4 = n3 < 3 ? t5 : null === s5 ? s5 = Object.getOwnPropertyDescriptor(t5, i6) : s5;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o4 = Reflect.decorate(e5, t5, i6, s5);
          else for (var a3 = e5.length - 1; a3 >= 0; a3--) (r4 = e5[a3]) && (o4 = (n3 < 3 ? r4(o4) : n3 > 3 ? r4(t5, i6, o4) : r4(t5, i6)) || o4);
          return n3 > 3 && o4 && Object.defineProperty(t5, i6, o4), o4;
        }, r3 = this && this.__param || function(e5, t5) {
          return function(i6, s5) {
            t5(i6, s5, e5);
          };
        };
        Object.defineProperty(t4, "__esModule", { value: true }), t4.OscLinkService = void 0;
        const n2 = i5(2585);
        let o3 = t4.OscLinkService = class {
          constructor(e5) {
            this._bufferService = e5, this._nextId = 1, this._entriesWithId = /* @__PURE__ */ new Map(), this._dataByLinkId = /* @__PURE__ */ new Map();
          }
          registerLink(e5) {
            const t5 = this._bufferService.buffer;
            if (void 0 === e5.id) {
              const i7 = t5.addMarker(t5.ybase + t5.y), s6 = { data: e5, id: this._nextId++, lines: [i7] };
              return i7.onDispose(() => this._removeMarkerFromLink(s6, i7)), this._dataByLinkId.set(s6.id, s6), s6.id;
            }
            const i6 = e5, s5 = this._getEntryIdKey(i6), r4 = this._entriesWithId.get(s5);
            if (r4) return this.addLineToLink(r4.id, t5.ybase + t5.y), r4.id;
            const n3 = t5.addMarker(t5.ybase + t5.y), o4 = { id: this._nextId++, key: this._getEntryIdKey(i6), data: i6, lines: [n3] };
            return n3.onDispose(() => this._removeMarkerFromLink(o4, n3)), this._entriesWithId.set(o4.key, o4), this._dataByLinkId.set(o4.id, o4), o4.id;
          }
          addLineToLink(e5, t5) {
            const i6 = this._dataByLinkId.get(e5);
            if (i6 && i6.lines.every((e6) => e6.line !== t5)) {
              const e6 = this._bufferService.buffer.addMarker(t5);
              i6.lines.push(e6), e6.onDispose(() => this._removeMarkerFromLink(i6, e6));
            }
          }
          getLinkData(e5) {
            return this._dataByLinkId.get(e5)?.data;
          }
          _getEntryIdKey(e5) {
            return `${e5.id};;${e5.uri}`;
          }
          _removeMarkerFromLink(e5, t5) {
            const i6 = e5.lines.indexOf(t5);
            -1 !== i6 && (e5.lines.splice(i6, 1), 0 === e5.lines.length && (void 0 !== e5.data.id && this._entriesWithId.delete(e5.key), this._dataByLinkId.delete(e5.id)));
          }
        };
        t4.OscLinkService = o3 = s4([r3(0, n2.IBufferService)], o3);
      }, 8343: (e4, t4) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.createDecorator = t4.getServiceDependencies = t4.serviceRegistry = void 0;
        const i5 = "di$target", s4 = "di$dependencies";
        t4.serviceRegistry = /* @__PURE__ */ new Map(), t4.getServiceDependencies = function(e5) {
          return e5[s4] || [];
        }, t4.createDecorator = function(e5) {
          if (t4.serviceRegistry.has(e5)) return t4.serviceRegistry.get(e5);
          const r3 = function(e6, t5, n2) {
            if (3 !== arguments.length) throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
            !function(e7, t6, r4) {
              t6[i5] === t6 ? t6[s4].push({ id: e7, index: r4 }) : (t6[s4] = [{ id: e7, index: r4 }], t6[i5] = t6);
            }(r3, e6, n2);
          };
          return r3.toString = () => e5, t4.serviceRegistry.set(e5, r3), r3;
        };
      }, 2585: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.IDecorationService = t4.IUnicodeService = t4.IOscLinkService = t4.IOptionsService = t4.ILogService = t4.LogLevelEnum = t4.IInstantiationService = t4.ICharsetService = t4.ICoreService = t4.ICoreMouseService = t4.IBufferService = void 0;
        const s4 = i5(8343);
        var r3;
        t4.IBufferService = (0, s4.createDecorator)("BufferService"), t4.ICoreMouseService = (0, s4.createDecorator)("CoreMouseService"), t4.ICoreService = (0, s4.createDecorator)("CoreService"), t4.ICharsetService = (0, s4.createDecorator)("CharsetService"), t4.IInstantiationService = (0, s4.createDecorator)("InstantiationService"), function(e5) {
          e5[e5.TRACE = 0] = "TRACE", e5[e5.DEBUG = 1] = "DEBUG", e5[e5.INFO = 2] = "INFO", e5[e5.WARN = 3] = "WARN", e5[e5.ERROR = 4] = "ERROR", e5[e5.OFF = 5] = "OFF";
        }(r3 || (t4.LogLevelEnum = r3 = {})), t4.ILogService = (0, s4.createDecorator)("LogService"), t4.IOptionsService = (0, s4.createDecorator)("OptionsService"), t4.IOscLinkService = (0, s4.createDecorator)("OscLinkService"), t4.IUnicodeService = (0, s4.createDecorator)("UnicodeService"), t4.IDecorationService = (0, s4.createDecorator)("DecorationService");
      }, 1480: (e4, t4, i5) => {
        Object.defineProperty(t4, "__esModule", { value: true }), t4.UnicodeService = void 0;
        const s4 = i5(8460), r3 = i5(225);
        class n2 {
          static extractShouldJoin(e5) {
            return 0 != (1 & e5);
          }
          static extractWidth(e5) {
            return e5 >> 1 & 3;
          }
          static extractCharKind(e5) {
            return e5 >> 3;
          }
          static createPropertyValue(e5, t5, i6 = false) {
            return (16777215 & e5) << 3 | (3 & t5) << 1 | (i6 ? 1 : 0);
          }
          constructor() {
            this._providers = /* @__PURE__ */ Object.create(null), this._active = "", this._onChange = new s4.EventEmitter(), this.onChange = this._onChange.event;
            const e5 = new r3.UnicodeV6();
            this.register(e5), this._active = e5.version, this._activeProvider = e5;
          }
          dispose() {
            this._onChange.dispose();
          }
          get versions() {
            return Object.keys(this._providers);
          }
          get activeVersion() {
            return this._active;
          }
          set activeVersion(e5) {
            if (!this._providers[e5]) throw new Error(`unknown Unicode version "${e5}"`);
            this._active = e5, this._activeProvider = this._providers[e5], this._onChange.fire(e5);
          }
          register(e5) {
            this._providers[e5.version] = e5;
          }
          wcwidth(e5) {
            return this._activeProvider.wcwidth(e5);
          }
          getStringCellWidth(e5) {
            let t5 = 0, i6 = 0;
            const s5 = e5.length;
            for (let r4 = 0; r4 < s5; ++r4) {
              let o3 = e5.charCodeAt(r4);
              if (55296 <= o3 && o3 <= 56319) {
                if (++r4 >= s5) return t5 + this.wcwidth(o3);
                const i7 = e5.charCodeAt(r4);
                56320 <= i7 && i7 <= 57343 ? o3 = 1024 * (o3 - 55296) + i7 - 56320 + 65536 : t5 += this.wcwidth(i7);
              }
              const a3 = this.charProperties(o3, i6);
              let h3 = n2.extractWidth(a3);
              n2.extractShouldJoin(a3) && (h3 -= n2.extractWidth(i6)), t5 += h3, i6 = a3;
            }
            return t5;
          }
          charProperties(e5, t5) {
            return this._activeProvider.charProperties(e5, t5);
          }
        }
        t4.UnicodeService = n2;
      } }, t3 = {};
      function i4(s4) {
        var r3 = t3[s4];
        if (void 0 !== r3) return r3.exports;
        var n2 = t3[s4] = { exports: {} };
        return e3[s4].call(n2.exports, n2, n2.exports, i4), n2.exports;
      }
      var s3 = {};
      return (() => {
        var e4 = s3;
        Object.defineProperty(e4, "__esModule", { value: true }), e4.Terminal = void 0;
        const t4 = i4(9042), r3 = i4(3236), n2 = i4(844), o3 = i4(5741), a3 = i4(8285), h3 = i4(7975), c3 = i4(7090), l3 = ["cols", "rows"];
        class d3 extends n2.Disposable {
          constructor(e5) {
            super(), this._core = this.register(new r3.Terminal(e5)), this._addonManager = this.register(new o3.AddonManager()), this._publicOptions = { ...this._core.options };
            const t5 = (e6) => this._core.options[e6], i5 = (e6, t6) => {
              this._checkReadonlyOptions(e6), this._core.options[e6] = t6;
            };
            for (const e6 in this._core.options) {
              const s4 = { get: t5.bind(this, e6), set: i5.bind(this, e6) };
              Object.defineProperty(this._publicOptions, e6, s4);
            }
          }
          _checkReadonlyOptions(e5) {
            if (l3.includes(e5)) throw new Error(`Option "${e5}" can only be set in the constructor`);
          }
          _checkProposedApi() {
            if (!this._core.optionsService.rawOptions.allowProposedApi) throw new Error("You must set the allowProposedApi option to true to use proposed API");
          }
          get onBell() {
            return this._core.onBell;
          }
          get onBinary() {
            return this._core.onBinary;
          }
          get onCursorMove() {
            return this._core.onCursorMove;
          }
          get onData() {
            return this._core.onData;
          }
          get onKey() {
            return this._core.onKey;
          }
          get onLineFeed() {
            return this._core.onLineFeed;
          }
          get onRender() {
            return this._core.onRender;
          }
          get onResize() {
            return this._core.onResize;
          }
          get onScroll() {
            return this._core.onScroll;
          }
          get onSelectionChange() {
            return this._core.onSelectionChange;
          }
          get onTitleChange() {
            return this._core.onTitleChange;
          }
          get onWriteParsed() {
            return this._core.onWriteParsed;
          }
          get element() {
            return this._core.element;
          }
          get parser() {
            return this._parser || (this._parser = new h3.ParserApi(this._core)), this._parser;
          }
          get unicode() {
            return this._checkProposedApi(), new c3.UnicodeApi(this._core);
          }
          get textarea() {
            return this._core.textarea;
          }
          get rows() {
            return this._core.rows;
          }
          get cols() {
            return this._core.cols;
          }
          get buffer() {
            return this._buffer || (this._buffer = this.register(new a3.BufferNamespaceApi(this._core))), this._buffer;
          }
          get markers() {
            return this._checkProposedApi(), this._core.markers;
          }
          get modes() {
            const e5 = this._core.coreService.decPrivateModes;
            let t5 = "none";
            switch (this._core.coreMouseService.activeProtocol) {
              case "X10":
                t5 = "x10";
                break;
              case "VT200":
                t5 = "vt200";
                break;
              case "DRAG":
                t5 = "drag";
                break;
              case "ANY":
                t5 = "any";
            }
            return { applicationCursorKeysMode: e5.applicationCursorKeys, applicationKeypadMode: e5.applicationKeypad, bracketedPasteMode: e5.bracketedPasteMode, insertMode: this._core.coreService.modes.insertMode, mouseTrackingMode: t5, originMode: e5.origin, reverseWraparoundMode: e5.reverseWraparound, sendFocusMode: e5.sendFocus, wraparoundMode: e5.wraparound };
          }
          get options() {
            return this._publicOptions;
          }
          set options(e5) {
            for (const t5 in e5) this._publicOptions[t5] = e5[t5];
          }
          blur() {
            this._core.blur();
          }
          focus() {
            this._core.focus();
          }
          input(e5, t5 = true) {
            this._core.input(e5, t5);
          }
          resize(e5, t5) {
            this._verifyIntegers(e5, t5), this._core.resize(e5, t5);
          }
          open(e5) {
            this._core.open(e5);
          }
          attachCustomKeyEventHandler(e5) {
            this._core.attachCustomKeyEventHandler(e5);
          }
          attachCustomWheelEventHandler(e5) {
            this._core.attachCustomWheelEventHandler(e5);
          }
          registerLinkProvider(e5) {
            return this._core.registerLinkProvider(e5);
          }
          registerCharacterJoiner(e5) {
            return this._checkProposedApi(), this._core.registerCharacterJoiner(e5);
          }
          deregisterCharacterJoiner(e5) {
            this._checkProposedApi(), this._core.deregisterCharacterJoiner(e5);
          }
          registerMarker(e5 = 0) {
            return this._verifyIntegers(e5), this._core.registerMarker(e5);
          }
          registerDecoration(e5) {
            return this._checkProposedApi(), this._verifyPositiveIntegers(e5.x ?? 0, e5.width ?? 0, e5.height ?? 0), this._core.registerDecoration(e5);
          }
          hasSelection() {
            return this._core.hasSelection();
          }
          select(e5, t5, i5) {
            this._verifyIntegers(e5, t5, i5), this._core.select(e5, t5, i5);
          }
          getSelection() {
            return this._core.getSelection();
          }
          getSelectionPosition() {
            return this._core.getSelectionPosition();
          }
          clearSelection() {
            this._core.clearSelection();
          }
          selectAll() {
            this._core.selectAll();
          }
          selectLines(e5, t5) {
            this._verifyIntegers(e5, t5), this._core.selectLines(e5, t5);
          }
          dispose() {
            super.dispose();
          }
          scrollLines(e5) {
            this._verifyIntegers(e5), this._core.scrollLines(e5);
          }
          scrollPages(e5) {
            this._verifyIntegers(e5), this._core.scrollPages(e5);
          }
          scrollToTop() {
            this._core.scrollToTop();
          }
          scrollToBottom() {
            this._core.scrollToBottom();
          }
          scrollToLine(e5) {
            this._verifyIntegers(e5), this._core.scrollToLine(e5);
          }
          clear() {
            this._core.clear();
          }
          write(e5, t5) {
            this._core.write(e5, t5);
          }
          writeln(e5, t5) {
            this._core.write(e5), this._core.write("\r\n", t5);
          }
          paste(e5) {
            this._core.paste(e5);
          }
          refresh(e5, t5) {
            this._verifyIntegers(e5, t5), this._core.refresh(e5, t5);
          }
          reset() {
            this._core.reset();
          }
          clearTextureAtlas() {
            this._core.clearTextureAtlas();
          }
          loadAddon(e5) {
            this._addonManager.loadAddon(this, e5);
          }
          static get strings() {
            return t4;
          }
          _verifyIntegers(...e5) {
            for (const t5 of e5) if (t5 === 1 / 0 || isNaN(t5) || t5 % 1 != 0) throw new Error("This API only accepts integers");
          }
          _verifyPositiveIntegers(...e5) {
            for (const t5 of e5) if (t5 && (t5 === 1 / 0 || isNaN(t5) || t5 % 1 != 0 || t5 < 0)) throw new Error("This API only accepts positive integers");
          }
        }
        e4.Terminal = d3;
      })(), s3;
    })());
  }
});

// node_modules/@xterm/addon-fit/lib/addon-fit.js
var require_addon_fit = __commonJS({
  "node_modules/@xterm/addon-fit/lib/addon-fit.js"(exports, module) {
    !function(e3, t3) {
      "object" == typeof exports && "object" == typeof module ? module.exports = t3() : "function" == typeof define && define.amd ? define([], t3) : "object" == typeof exports ? exports.FitAddon = t3() : e3.FitAddon = t3();
    }(self, () => (() => {
      "use strict";
      var e3 = {};
      return (() => {
        var t3 = e3;
        Object.defineProperty(t3, "__esModule", { value: true }), t3.FitAddon = void 0, t3.FitAddon = class {
          activate(e4) {
            this._terminal = e4;
          }
          dispose() {
          }
          fit() {
            const e4 = this.proposeDimensions();
            if (!e4 || !this._terminal || isNaN(e4.cols) || isNaN(e4.rows)) return;
            const t4 = this._terminal._core;
            this._terminal.rows === e4.rows && this._terminal.cols === e4.cols || (t4._renderService.clear(), this._terminal.resize(e4.cols, e4.rows));
          }
          proposeDimensions() {
            if (!this._terminal) return;
            if (!this._terminal.element || !this._terminal.element.parentElement) return;
            const e4 = this._terminal._core, t4 = e4._renderService.dimensions;
            if (0 === t4.css.cell.width || 0 === t4.css.cell.height) return;
            const r3 = 0 === this._terminal.options.scrollback ? 0 : e4.viewport.scrollBarWidth, i4 = window.getComputedStyle(this._terminal.element.parentElement), o3 = parseInt(i4.getPropertyValue("height")), s3 = Math.max(0, parseInt(i4.getPropertyValue("width"))), n2 = window.getComputedStyle(this._terminal.element), l3 = o3 - (parseInt(n2.getPropertyValue("padding-top")) + parseInt(n2.getPropertyValue("padding-bottom"))), a3 = s3 - (parseInt(n2.getPropertyValue("padding-right")) + parseInt(n2.getPropertyValue("padding-left"))) - r3;
            return { cols: Math.max(2, Math.floor(a3 / t4.css.cell.width)), rows: Math.max(1, Math.floor(l3 / t4.css.cell.height)) };
          }
        };
      })(), e3;
    })());
  }
});

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
  { id: "grid", label: "Grid", icon: "sessions", href: "/grid" },
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

// src/components/organisms/InteractiveTerminal.tsx
var import_xterm = __toESM(require_xterm(), 1);
var import_addon_fit = __toESM(require_addon_fit(), 1);
function InteractiveTerminal({ ticket }) {
  const containerRef = A2(null);
  const termRef = A2(null);
  const wsRef = A2(null);
  const fitRef = A2(null);
  const [status, setStatus] = d2("connecting");
  const [errMsg, setErrMsg] = d2(null);
  y2(() => {
    if (!containerRef.current) return;
    const term = new import_xterm.Terminal({
      cursorBlink: true,
      fontFamily: "var(--font-mono), monospace",
      fontSize: 12,
      theme: {
        background: "#0b0e14",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4"
      },
      scrollback: 5e3,
      allowProposedApi: true
    });
    const fit = new import_addon_fit.FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/sessions/${encodeURIComponent(ticket)}/pty`);
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus("open");
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => {
      setStatus("error");
      setErrMsg("WebSocket error");
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "output":
          if (msg.data) term.write(msg.data);
          break;
        case "size":
          break;
        case "error":
          term.write(`\r
\x1B[31m[fleet] ${msg.msg}\x1B[0m\r
`);
          setErrMsg(msg.msg ?? "error");
          break;
      }
    };
    const sendInput = (d3) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: d3 }));
      }
    };
    term.onData(sendInput);
    const onResize = () => {
      try {
        fit.fit();
      } catch {
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      try {
        ws.close();
      } catch {
      }
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [ticket]);
  return /* @__PURE__ */ u3("div", { class: "interactive-terminal", children: [
    /* @__PURE__ */ u3("div", { class: "interactive-terminal__header", children: [
      /* @__PURE__ */ u3("span", { class: `interactive-terminal__status interactive-terminal__status--${status}`, children: status === "open" ? "\u25CF live" : status === "connecting" ? "\u25CB connecting" : status === "closed" ? "\u25CB closed" : "\u2717 error" }),
      /* @__PURE__ */ u3("span", { class: "interactive-terminal__hint", children: [
        "PTY \xB7 ",
        ticket
      ] }),
      errMsg ? /* @__PURE__ */ u3("span", { class: "interactive-terminal__err", children: errMsg }) : null
    ] }),
    /* @__PURE__ */ u3("div", { ref: containerRef, class: "interactive-terminal__xterm" })
  ] });
}

// src/api.ts
async function fetchGitStatus(ticket) {
  const r3 = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/git`);
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
async function fetchPRStatus(ticket) {
  const r3 = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/pr`);
  if (!r3.ok) throw new Error(await readError(r3));
  return r3.json();
}
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

// src/components/organisms/GitTab.tsx
function GitTab({ ticket }) {
  const [data, setData] = d2(null);
  const [err, setErr] = d2(null);
  y2(() => {
    setData(null);
    setErr(null);
    fetchGitStatus(ticket).then(setData).catch((e3) => setErr(e3.message));
    const id = window.setInterval(() => {
      fetchGitStatus(ticket).then(setData).catch(() => {
      });
    }, 5e3);
    return () => window.clearInterval(id);
  }, [ticket]);
  if (err) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)" }, children: err });
  if (!data) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: "Loading git status\u2026" });
  return /* @__PURE__ */ u3("div", { style: { display: "grid", gap: "var(--space-4)" }, children: [
    /* @__PURE__ */ u3("dl", { class: "detail-panel__meta", children: [
      /* @__PURE__ */ u3("dt", { children: "Worktree" }),
      /* @__PURE__ */ u3("dd", { children: /* @__PURE__ */ u3("code", { children: data.worktree }) }),
      /* @__PURE__ */ u3("dt", { children: "Branch" }),
      /* @__PURE__ */ u3("dd", { children: /* @__PURE__ */ u3("code", { children: data.branch || "\u2014" }) }),
      /* @__PURE__ */ u3("dt", { children: "Status" }),
      /* @__PURE__ */ u3("dd", { children: data.clean ? /* @__PURE__ */ u3("span", { style: { color: "var(--color-state-done)" }, children: "\u25CF clean" }) : /* @__PURE__ */ u3("span", { style: { color: "var(--color-state-needs-input)" }, children: [
        "\u25CF ",
        data.files.length,
        " change",
        data.files.length === 1 ? "" : "s"
      ] }) })
    ] }),
    data.files.length > 0 ? /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3("h3", { style: { margin: "0 0 8px", fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)" }, children: "Working tree" }),
      /* @__PURE__ */ u3("ul", { class: "git-files", children: data.files.map((f4) => /* @__PURE__ */ u3("li", { children: [
        /* @__PURE__ */ u3("code", { class: `git-files__status git-files__status--${(f4.status[0] || " ").trim() || "untracked"}`, children: f4.status }),
        /* @__PURE__ */ u3("code", { children: f4.path })
      ] }, f4.path)) })
    ] }) : null,
    data.log.length > 0 ? /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3("h3", { style: { margin: "0 0 8px", fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)" }, children: "Recent commits" }),
      /* @__PURE__ */ u3("ul", { class: "git-log", children: data.log.map((e3) => /* @__PURE__ */ u3("li", { children: [
        /* @__PURE__ */ u3("code", { class: "git-log__hash", children: e3.hash }),
        /* @__PURE__ */ u3("span", { class: "git-log__subject", children: e3.subject }),
        /* @__PURE__ */ u3("span", { class: "git-log__when", children: [
          e3.when,
          " \xB7 ",
          e3.author
        ] })
      ] }, e3.hash)) })
    ] }) : null
  ] });
}

// src/components/organisms/PRTab.tsx
function PRTab({ ticket }) {
  const [data, setData] = d2(null);
  const [err, setErr] = d2(null);
  y2(() => {
    setData(null);
    setErr(null);
    fetchPRStatus(ticket).then(setData).catch((e3) => setErr(e3.message));
  }, [ticket]);
  if (err) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)" }, children: err });
  if (!data) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: "Loading PR\u2026" });
  if (!data.available) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: data.error ?? "gh CLI not available" });
  if (data.error) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: data.error });
  const stateColor = data.state === "OPEN" ? "var(--color-state-working)" : data.state === "MERGED" ? "var(--color-state-done)" : data.state === "CLOSED" ? "var(--color-state-error)" : "var(--color-text-secondary)";
  return /* @__PURE__ */ u3("div", { style: { display: "grid", gap: "var(--space-4)" }, children: [
    /* @__PURE__ */ u3("div", { style: { display: "flex", alignItems: "center", gap: "var(--space-3)" }, children: [
      /* @__PURE__ */ u3("strong", { style: { fontSize: "var(--text-lg)" }, children: [
        "#",
        data.number
      ] }),
      /* @__PURE__ */ u3("span", { style: { fontWeight: 600, color: stateColor }, children: data.state }),
      data.url ? /* @__PURE__ */ u3("a", { href: data.url, target: "_blank", rel: "noopener", children: "view on github" }) : null
    ] }),
    /* @__PURE__ */ u3("div", { style: { fontSize: "var(--text-md)" }, children: data.title }),
    /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }, children: [
      "by ",
      data.author
    ] }),
    data.checks && data.checks.length > 0 ? /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3("h3", { style: { margin: "0 0 8px", fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)" }, children: "Checks" }),
      /* @__PURE__ */ u3("ul", { class: "pr-checks", children: data.checks.map((c3, i4) => {
        const tone = c3.conclusion === "success" ? "var(--color-state-done)" : c3.conclusion === "failure" ? "var(--color-state-error)" : "var(--color-state-needs-input)";
        return /* @__PURE__ */ u3("li", { children: [
          /* @__PURE__ */ u3("span", { style: { color: tone }, children: [
            "\u25CF ",
            c3.conclusion || c3.state
          ] }),
          /* @__PURE__ */ u3("span", { children: c3.name }),
          c3.workflow ? /* @__PURE__ */ u3("span", { class: "pr-checks__workflow", children: c3.workflow }) : null
        ] }, i4);
      }) })
    ] }) : null,
    data.files && data.files.length > 0 ? /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3("h3", { style: { margin: "0 0 8px", fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)" }, children: [
        "Files changed (",
        data.files.length,
        ")"
      ] }),
      /* @__PURE__ */ u3("ul", { class: "pr-files", children: [
        data.files.slice(0, 50).map((f4) => /* @__PURE__ */ u3("li", { children: /* @__PURE__ */ u3("code", { children: f4 }) }, f4)),
        data.files.length > 50 ? /* @__PURE__ */ u3("li", { style: { color: "var(--color-text-tertiary)" }, children: [
          "\u2026 ",
          data.files.length - 50,
          " more"
        ] }) : null
      ] })
    ] }) : null
  ] });
}

// src/components/organisms/EventsTab.tsx
function EventsTab({ ticket }) {
  const [data, setData] = d2(null);
  const [err, setErr] = d2(null);
  y2(() => {
    setData(null);
    setErr(null);
    const load = () => fetch(`/api/events?limit=200`).then((r3) => r3.ok ? r3.json() : Promise.reject(new Error(`${r3.status} ${r3.statusText}`))).then((all) => setData(all.filter((e3) => e3.ticket === ticket))).catch((e3) => setErr(e3.message));
    load();
    const id = window.setInterval(load, 5e3);
    return () => window.clearInterval(id);
  }, [ticket]);
  if (err) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)" }, children: err });
  if (!data) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: "Loading events\u2026" });
  if (data.length === 0) return /* @__PURE__ */ u3("div", { style: { color: "var(--color-text-tertiary)" }, children: [
    "No events yet for ",
    ticket,
    "."
  ] });
  return /* @__PURE__ */ u3("ul", { class: "audit-list", style: { borderRadius: "var(--radius-md)" }, children: data.map((e3) => /* @__PURE__ */ u3("li", { class: "audit-list__row", children: [
    /* @__PURE__ */ u3("div", { class: "audit-list__time", children: new Date(e3.ts).toLocaleString() }),
    /* @__PURE__ */ u3("div", { class: "audit-list__ticket", children: e3.ticket }),
    /* @__PURE__ */ u3("div", { class: "audit-list__kind", children: e3.kind }),
    /* @__PURE__ */ u3("div", { class: "audit-list__detail", children: /* @__PURE__ */ u3("code", { style: { fontSize: "var(--text-xs)" }, children: summarize(e3.detail) }) })
  ] }, e3.id)) });
}
function summarize(detail) {
  const keys = Object.keys(detail);
  if (keys.length === 0) return "";
  return keys.slice(0, 4).map((k3) => {
    const v3 = detail[k3];
    const s3 = typeof v3 === "string" ? v3 : JSON.stringify(v3);
    return `${k3}=${s3.length > 60 ? s3.slice(0, 57) + "\u2026" : s3}`;
  }).join(" \xB7 ");
}

// src/components/organisms/SessionDetailPanel.tsx
var TABS = ["Overview", "Terminal", "Logs", "Events", "Git", "PR"];
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
    /* @__PURE__ */ u3("div", { class: "detail-panel__body", children: error ? /* @__PURE__ */ u3("div", { style: { color: "var(--color-state-error)" }, children: error }) : tab === "Overview" ? /* @__PURE__ */ u3(OverviewTab, { row: data }) : tab === "Terminal" ? /* @__PURE__ */ u3(InteractiveTerminal, { ticket }) : tab === "Logs" ? /* @__PURE__ */ u3(TerminalView, { ticket }) : tab === "Events" ? /* @__PURE__ */ u3(EventsTab, { ticket }) : tab === "Git" ? /* @__PURE__ */ u3(GitTab, { ticket }) : /* @__PURE__ */ u3(PRTab, { ticket }) }),
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
    /* @__PURE__ */ u3("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "var(--space-3)" }, children: [
      /* @__PURE__ */ u3("span", { class: "auth-pill", children: [
        "depth ",
        row.depth ?? 0
      ] }),
      row.full_auto ? /* @__PURE__ */ u3("span", { class: "auth-pill auth-pill--strong", children: "--full-auto" }) : null,
      row.parent ? /* @__PURE__ */ u3("span", { class: "auth-pill", children: [
        "parent ",
        row.parent
      ] }) : null
    ] }),
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

// src/components/organisms/TreeView.tsx
function TreeView({ rows, onRowClick }) {
  const tree = T2(() => buildTree(rows), [rows]);
  return /* @__PURE__ */ u3("ul", { class: "tree-view", children: tree.map((n2) => /* @__PURE__ */ u3(TreeNode, { node: n2, onRowClick, depth: 0 }, n2.row.ticket)) });
}
function buildTree(rows) {
  const byTicket = /* @__PURE__ */ new Map();
  rows.forEach((r3) => byTicket.set(r3.ticket, { row: r3, children: [] }));
  const roots = [];
  byTicket.forEach((n2) => {
    const p3 = n2.row.parent && byTicket.get(n2.row.parent);
    if (p3) p3.children.push(n2);
    else roots.push(n2);
  });
  return roots;
}
function TreeNode({ node, onRowClick, depth }) {
  const [open, setOpen] = d2(true);
  const hasChildren = node.children.length > 0;
  return /* @__PURE__ */ u3("li", { class: "tree-view__node", children: [
    /* @__PURE__ */ u3("div", { class: "tree-view__row", onClick: () => onRowClick?.(node.row), style: { paddingLeft: `${depth * 16 + 8}px` }, children: [
      /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "tree-view__toggle",
          onClick: (e3) => {
            e3.stopPropagation();
            setOpen((v3) => !v3);
          },
          "aria-label": hasChildren ? open ? "Collapse" : "Expand" : "",
          style: { visibility: hasChildren ? "visible" : "hidden" },
          children: open ? "\u25BE" : "\u25B8"
        }
      ),
      /* @__PURE__ */ u3("strong", { children: node.row.ticket }),
      /* @__PURE__ */ u3("span", { style: { color: "var(--color-text-secondary)" }, children: node.row.slug || "\u2014" }),
      /* @__PURE__ */ u3(Badge, { state: node.row.state }),
      /* @__PURE__ */ u3("span", { style: { flex: 1 } }),
      /* @__PURE__ */ u3("span", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }, children: node.row.activity })
    ] }),
    hasChildren && open ? /* @__PURE__ */ u3("ul", { class: "tree-view__children", children: node.children.map((c3) => /* @__PURE__ */ u3(TreeNode, { node: c3, onRowClick, depth: depth + 1 }, c3.row.ticket)) }) : null
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
  const [showTree, setShowTree] = usePersistentState("fleet.showTree", false);
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
            showTree && sessions.data && sessions.data.length > 0 ? /* @__PURE__ */ u3("div", { style: { marginBottom: 16 }, children: [
              /* @__PURE__ */ u3("h3", { style: { fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)", marginBottom: 8 }, children: "Parent \u2192 child tree" }),
              /* @__PURE__ */ u3(TreeView, { rows: sessions.data, onRowClick: (r3) => setSelected(r3.ticket) })
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
                      onClick: () => setShowTree(!showTree),
                      title: "Toggle parent \u2192 child tree view",
                      children: showTree ? "Hide tree" : "Show tree"
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
      /* @__PURE__ */ u3("div", { class: "audit-list__detail", children: /* @__PURE__ */ u3("code", { style: { fontSize: "var(--text-xs)" }, children: summarize2(e3.detail) }) })
    ] }, e3.id)) })
  ] });
}
function formatTime(ts) {
  const d3 = new Date(ts);
  if (Number.isNaN(d3.getTime())) return String(ts);
  return d3.toLocaleString();
}
function summarize2(detail) {
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
  if (path === "grid") return { name: "grid", params: {} };
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

// src/components/organisms/GridLayout.tsx
var GRID_STRATEGIES = [
  { id: "2x2", label: "Grid 2\xD72", max: 4 },
  { id: "3x3", label: "Grid 3\xD73", max: 9 },
  { id: "1plusN", label: "1+N", max: 4 },
  { id: "spotlight", label: "Spotlight", max: 5 }
];
function GridLayout({ strategy, children }) {
  return /* @__PURE__ */ u3("div", { class: `grid-layout grid-layout--${strategy}`, children });
}

// src/components/organisms/PtyTile.tsx
function PtyTile({ row }) {
  return /* @__PURE__ */ u3("div", { class: "pty-tile", children: [
    /* @__PURE__ */ u3("div", { class: "pty-tile__header", children: [
      /* @__PURE__ */ u3("strong", { children: row.ticket }),
      /* @__PURE__ */ u3("span", { style: { color: "var(--color-text-tertiary)" }, children: row.slug || "\u2014" }),
      /* @__PURE__ */ u3(Badge, { state: row.state })
    ] }),
    /* @__PURE__ */ u3("div", { class: "pty-tile__body", children: /* @__PURE__ */ u3(InteractiveTerminal, { ticket: row.ticket }) })
  ] });
}

// src/components/pages/GridPage.tsx
var ACTIVE = /* @__PURE__ */ new Set(["starting", "working", "needs-input", "reviewing"]);
function GridPage() {
  const sessions = useSessionList();
  const [strategy, setStrategy] = usePersistentState("fleet.grid", "2x2");
  const max = GRID_STRATEGIES.find((s3) => s3.id === strategy)?.max ?? 4;
  const tiles = (sessions.data ?? []).filter((r3) => ACTIVE.has(r3.state)).slice(0, max);
  return /* @__PURE__ */ u3(AppShell, { activeView: "sessions", topBarTitle: "Multi-Agent Grid", children: /* @__PURE__ */ u3("div", { class: "grid-page", children: [
    /* @__PURE__ */ u3("div", { class: "grid-page__toolbar", children: [
      /* @__PURE__ */ u3("strong", { style: { fontSize: "var(--text-sm)" }, children: "Layout:" }),
      /* @__PURE__ */ u3("span", { class: "filter-chips", role: "group", "aria-label": "Layout", children: GRID_STRATEGIES.map((s3) => /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: `filter-chip${s3.id === strategy ? " filter-chip--active" : ""}`,
          onClick: () => setStrategy(s3.id),
          children: s3.label
        },
        s3.id
      )) }),
      /* @__PURE__ */ u3("span", { style: { flex: 1 } }),
      /* @__PURE__ */ u3("span", { style: { fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }, children: [
        tiles.length,
        " / ",
        (sessions.data ?? []).filter((r3) => ACTIVE.has(r3.state)).length,
        " active"
      ] })
    ] }),
    tiles.length === 0 ? /* @__PURE__ */ u3("div", { style: { padding: "var(--space-8)", textAlign: "center", color: "var(--color-text-secondary)" }, children: "No active sessions to grid. Spawn one or two and reload." }) : /* @__PURE__ */ u3(GridLayout, { strategy, children: tiles.map((r3) => /* @__PURE__ */ u3(PtyTile, { row: r3 }, r3.ticket)) })
  ] }) });
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
    case "grid":
      return /* @__PURE__ */ u3(GridPage, {});
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
