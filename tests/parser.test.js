// 解析ロジックのテスト（サンプルメールは架空）。実行: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../parser.js");

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Gmail API（format=full）のメッセージを模したもの
function makeMessage(subject, body, { html = false, charset = "utf-8", encodedBody } = {}) {
  const mimeType = html ? "text/html" : "text/plain";
  return {
    id: "msg-" + Math.abs([...subject + body].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)),
    internalDate: String(Date.UTC(2026, 9, 10, 2, 36, 31)),
    payload: {
      mimeType: "multipart/alternative",
      headers: [{ name: "Subject", value: subject }],
      parts: [{
        mimeType,
        filename: "",
        headers: [{ name: "Content-Type", value: `${mimeType}; charset="${charset}"` }],
        body: { data: encodedBody ?? b64url(Buffer.from(body, "utf-8")) },
      }],
    },
  };
}

const PAYMENT_BODY = `テスト 様
Woven City Payのお支払いが完了いたしました。
取引日時: 2026年10月10日 11時36分
支払種別: プリペイド支払い
ストア名: en-1
利用金額: 800 円
取引ID: pay_TEST
`;

const CARD_BODY = `取引日時: 2026年09月25日 10時02分
支払種別: クレジット支払い
ストア名: 賃料
利用明細: 202611-賃料
利用金額: 99,000 円
`;

const CHARGE_BODY = `チャージ日時: 2026年10月02日 21時21分
チャージ金額: 14,000 円
`;

const parse = (subject, body, opts) => P.parseGmailMessage(makeMessage(subject, body, opts));

test("payment subjects", () => {
  for (const subject of ["【Woven City Pay】お支払い完了のお知らせ / Payment Completed",
                         "【Woven City Pay】ご利用のお知らせ"]) {
    const tx = parse(subject, PAYMENT_BODY);
    assert.deepEqual([tx.type, tx.amount, tx.store, tx.datetime],
                     ["payment", 800, "en-1", "2026-10-10T11:36:00"], subject);
  }
});

test("card payment", () => {
  const tx = parse("【Woven City Pay】カード決済完了のお知らせ", CARD_BODY);
  assert.deepEqual([tx.type, tx.amount, tx.store], ["payment", 99000, "賃料"]);
});

test("charge", () => {
  const tx = parse("【Woven City Pay】チャージ完了のお知らせ / Top-up Completed", CHARGE_BODY);
  assert.deepEqual([tx.type, tx.amount, tx.store, tx.datetime], ["charge", 14000, "", "2026-10-02T21:21:00"]);
});

test("html and full-width", () => {
  const body = "<table><tr><td>ストア名</td><td>Ｃａｆｅ</td></tr><tr><td>利用金額</td><td>１，２３０円</td></tr></table>";
  const tx = parse("【Woven City Pay】ご利用のお知らせ", body, { html: true });
  assert.deepEqual([tx.amount, tx.store], [1230, "Cafe"]);
});

test("ignored mails", () => {
  assert.equal(parse("【Woven City Pay】残高送付完了のお知らせ", "残高送付金額: 1,000 円"), null);
  assert.equal(parse("【Woven City Pay】残高受け取りのお知らせ", "残高受取金額: 1,750 円"), null);
  assert.equal(parse("【Woven City Pay】登録完了のお知らせ", "登録が完了しました"), null);
  assert.equal(parse("Re: 【Woven City Pay】ご利用のお知らせ", PAYMENT_BODY), null);
});

test("amount not found is not imported", () => {
  assert.equal(parse("【Woven City Pay】ご利用のお知らせ", "本文なし"), null);
});

test("datetime falls back to the received time", () => {
  const tx = parse("【Woven City Pay】チャージ完了のお知らせ", "チャージ金額: 3,000 円");
  const d = new Date(Date.UTC(2026, 9, 10, 2, 36, 31));
  const pad = (n) => String(n).padStart(2, "0");
  assert.equal(tx.datetime, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
                            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
});

test("ISO-2022-JP body", () => {
  // "利用金額: 500 円" in ISO-2022-JP
  const iso = Buffer.from("1b24424d784d513662335b1b28423a20353030201b2442315f1b2842", "hex");
  const msg = makeMessage("【Woven City Pay】ご利用のお知らせ", "", { charset: "ISO-2022-JP", encodedBody: b64url(iso) });
  assert.equal(P.extractBody(msg.payload), "利用金額: 500 円");
  assert.equal(P.parseGmailMessage(msg).amount, 500);
});

test("plain part preferred, attachments skipped", () => {
  const msg = makeMessage("【Woven City Pay】ご利用のお知らせ", PAYMENT_BODY);
  msg.payload.parts.unshift({
    mimeType: "text/plain", filename: "a.txt", headers: [], body: { data: b64url(Buffer.from("利用金額: 1 円")) },
  });
  msg.payload.parts.push({
    mimeType: "text/html", filename: "", headers: [], body: { data: b64url(Buffer.from("<p>利用金額: 2 円</p>")) },
  });
  assert.equal(P.parseGmailMessage(msg).amount, 800);
});

test("encoded subject header", () => {
  const subject = "=?UTF-8?B?" + Buffer.from("【Woven City Pay】チャージ完了のお知らせ").toString("base64") + "?=";
  assert.equal(parse(subject, CHARGE_BODY).type, "charge");
});

test("invalid date in body is skipped", () => {
  assert.equal(P.parseDatetime("取引日時: 2026年02月30日 10時00分", "FB"), "FB");
});

test("html entities", () => {
  assert.equal(P.htmlToText("A&amp;B&#x3042;&#12354;<br>x"), "A&Bああ\nx");
});
