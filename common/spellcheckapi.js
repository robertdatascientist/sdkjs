/*
 * (c) Copyright Ascensio System SIA 2010-2016
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

"use strict";

(function(window) {
  'use strict';

  // Класс надстройка, для online и offline работы
  var CSpellCheckApi = function(options) {
    this._SpellCheckApi = new SpellCheckApi();
    this._onlineWork = false;

    if (options) {
      this.onDisconnect = options.onDisconnect;
      this.onSpellCheck = options.onSpellCheck;
    }
  };

  CSpellCheckApi.prototype.init = function(docid) {
    if (this._SpellCheckApi && this._SpellCheckApi.isRightURL()) {
      var t = this;
      this._SpellCheckApi.onDisconnect = function(e, isDisconnectAtAll, isCloseCoAuthoring) {
        t.callback_OnDisconnect(e, isDisconnectAtAll, isCloseCoAuthoring);
      };
      this._SpellCheckApi.onSpellCheck = function(e) {
        t.callback_OnSpellCheck(e);
      };

      this._SpellCheckApi.init(docid);
      this._onlineWork = true;
    }
  };

  CSpellCheckApi.prototype.set_url = function(url) {
    if (this._SpellCheckApi) {
      this._SpellCheckApi.set_url(url);
    }
  };

  CSpellCheckApi.prototype.get_state = function() {
    if (this._SpellCheckApi) {
      return this._SpellCheckApi.get_state();
    }

    return 0;
  };

  CSpellCheckApi.prototype.disconnect = function() {
    if (this._SpellCheckApi && this._onlineWork) {
      this._SpellCheckApi.disconnect();
    }
  };

  CSpellCheckApi.prototype.spellCheck = function(spellCheckData) {
    if (this._SpellCheckApi && this._onlineWork) {
      this._SpellCheckApi.spellCheck(spellCheckData);
    }
  };

  CSpellCheckApi.prototype.callback_OnSpellCheck = function(e) {
    if (this.onSpellCheck) {
      return this.onSpellCheck(e);
    }
  };

  /**
   * Event об отсоединении от сервера
   * @param {jQuery} e  event об отсоединении с причиной
   * @param {Bool} isDisconnectAtAll  окончательно ли отсоединяемся(true) или будем пробовать сделать reconnect(false) + сами отключились
   */
  CSpellCheckApi.prototype.callback_OnDisconnect = function(e, isDisconnectAtAll, isCloseCoAuthoring) {
    if (this.onDisconnect) {
      return this.onDisconnect(e, isDisconnectAtAll, isCloseCoAuthoring);
    }
  };

  /** States
   * -1 - reconnect state
   *  0 - not initialized
   *  1 - opened
   *  3 - closed
   */
  var SpellCheckApi = function(options) {
    if (options) {
      this.onDisconnect = options.onDisconnect;
      this.onConnect = options.onConnect;
      this.onSpellCheck = options.onSpellCheck;
    }
    this._state = 0;
    // Мы сами отключились от совместного редактирования
    this.isCloseCoAuthoring = false;

    // Массив данных, который стоит отправить как только подключимся
    this.dataNeedSend = [];

    this._url = "";
  };

  SpellCheckApi.prototype.isRightURL = function() {
    return ("" != this._url);
  };

  SpellCheckApi.prototype.set_url = function(url) {
    this._url = url;
  };

  SpellCheckApi.prototype.get_state = function() {
    return this._state;
  };

  SpellCheckApi.prototype.spellCheck = function(spellCheckData) {
    this._send({"type": "spellCheck", "spellCheckData": spellCheckData});
  };

  SpellCheckApi.prototype.disconnect = function() {
    // Отключаемся сами
    this.isCloseCoAuthoring = true;
    return this.sockjs.close();
  };

  SpellCheckApi.prototype._send = function(data) {
    if (data !== null && typeof data === "object") {
      if (this._state > 0) {
        this.sockjs.send(JSON.stringify(data));
      } else {
        this.dataNeedSend.push(data);
      }
    }
  };

  SpellCheckApi.prototype._sendAfterConnect = function() {
    var data;
    while (this._state > 0 && undefined !== (data = this.dataNeedSend.shift()))
      this._send(data);
  };

  SpellCheckApi.prototype._onSpellCheck = function(data) {
    if (undefined !== data["spellCheckData"] && this.onSpellCheck) {
      this.onSpellCheck(data["spellCheckData"]);
    }
  };

  var reconnectTimeout, attemptCount = 0;

  function initSocksJs(url, docsCoApi) {
    var sockjs = new (_getSockJs())(url, null, {debug: true});

    sockjs.onopen = function() {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        attemptCount = 0;
      }
      docsCoApi._state = 1; // Opened state
      if (docsCoApi.onConnect) {
        docsCoApi.onConnect();
      }

      // Отправляем все данные, которые пришли до соединения с сервером
      docsCoApi._sendAfterConnect();
    };

    sockjs.onmessage = function(e) {
      //TODO: add checks and error handling
      //Get data type
      var dataObject = JSON.parse(e.data);
      var type = dataObject.type;
      switch (type) {
        case 'spellCheck'  :
          docsCoApi._onSpellCheck(dataObject);
          break;
      }
    };
    sockjs.onclose = function(evt) {
      docsCoApi._state = -1; // Reconnect state
      var bIsDisconnectAtAll = attemptCount >= 20 || docsCoApi.isCloseCoAuthoring;
      if (bIsDisconnectAtAll) {
        docsCoApi._state = 3;
      } // Closed state
      if (docsCoApi.onDisconnect) {
        docsCoApi.onDisconnect(evt.reason, bIsDisconnectAtAll, docsCoApi.isCloseCoAuthoring);
      }
      if (docsCoApi.isCloseCoAuthoring) {
        return;
      }
      //Try reconect
      if (attemptCount < 20) {
        tryReconnect();
      }
    };

    function tryReconnect() {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      attemptCount++;
      reconnectTimeout = setTimeout(function() {
        delete docsCoApi.sockjs;
        docsCoApi.sockjs = initSocksJs(url, docsCoApi);
      }, 500 * attemptCount);

    }

    return sockjs;
  }

  function _getSockJs() {
    return window['SockJS'] ? window['SockJS'] : require('sockjs');
  }

  SpellCheckApi.prototype.init = function(docid) {
    this._docid = docid;
    //Begin send auth
    this.sockjs_url = this._url + '/doc/' + docid + '/c';
    this.sockjs = initSocksJs(this.sockjs_url, this);
  };

  //-----------------------------------------------------------export---------------------------------------------------
  window['AscCommon'] = window['AscCommon'] || {};
  window["AscCommon"].CSpellCheckApi = CSpellCheckApi;
})(window);

