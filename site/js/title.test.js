import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TITLE, INDIA_TITLE, inIndia, readEnvironment, siteTitle,
} from './title.js';

describe('inIndia, by timezone', () => {
  test('Asia/Kolkata', () => {
    assert.ok(inIndia({ timeZone: 'Asia/Kolkata', languages: ['en-US'] }));
  });

  test('Asia/Calcutta, the older name for the same zone', () => {
    assert.ok(inIndia({ timeZone: 'Asia/Calcutta', languages: ['en-US'] }));
  });

  test('a neighbouring zone is not India', () => {
    for (const zone of ['Asia/Karachi', 'Asia/Dhaka', 'Asia/Kathmandu',
      'Asia/Colombo', 'Europe/London', 'America/New_York']) {
      assert.equal(inIndia({ timeZone: zone, languages: [] }), false, zone);
    }
  });
});

describe('inIndia, by locale', () => {
  test('a region of IN counts, whatever the language', () => {
    for (const tag of ['en-IN', 'hi-IN', 'ta-IN', 'bn-IN', 'hi-Deva-IN']) {
      assert.ok(inIndia({ languages: [tag] }), tag);
    }
  });

  test('case does not matter - tags arrive unnormalised', () => {
    assert.ok(inIndia({ languages: ['en-in'] }));
  });

  test('any of the reader’s locales is enough, not just the first', () => {
    assert.ok(inIndia({ languages: ['en-GB', 'en-IN'] }));
  });

  test('a bare language is not a place', () => {
    // Hindi is read well outside India, and the title is a local joke.
    for (const tag of ['hi', 'ta', 'bn', 'en']) {
      assert.equal(inIndia({ languages: [tag] }), false, tag);
    }
  });

  test('"in" as the first subtag is Indonesian, not India', () => {
    // The deprecated code for Indonesian. Reading it as a region would put a
    // Hindi pun in front of readers in Jakarta.
    assert.equal(inIndia({ languages: ['in'] }), false);
    assert.equal(inIndia({ languages: ['in-ID'] }), false);
  });

  test('a region that merely contains "in" is not IN', () => {
    assert.equal(inIndia({ languages: ['en-SG', 'zh-Hans-CN'] }), false);
  });
});

describe('siteTitle', () => {
  test('India gets the local name', () => {
    assert.equal(siteTitle({ timeZone: 'Asia/Kolkata' }), INDIA_TITLE);
    assert.equal(siteTitle({ languages: ['en-IN'] }), INDIA_TITLE);
  });

  test('everywhere else gets the default', () => {
    assert.equal(siteTitle({ timeZone: 'Europe/Berlin', languages: ['de-DE'] }),
      DEFAULT_TITLE);
  });

  test('knowing nothing is not knowing you are in India', () => {
    assert.equal(siteTitle(), DEFAULT_TITLE);
    assert.equal(siteTitle({}), DEFAULT_TITLE);
    assert.equal(siteTitle({ timeZone: undefined, languages: [] }),
      DEFAULT_TITLE);
  });
});

describe('readEnvironment', () => {
  const fake = ({ timeZone, ...nav } = {}) => ({
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) },
    navigator: nav,
  });

  test('reads the zone and the locale list', () => {
    const env = readEnvironment(
      fake({ timeZone: 'Asia/Kolkata', languages: ['en-IN', 'hi'] }));
    assert.deepEqual(env, { timeZone: 'Asia/Kolkata', languages: ['en-IN', 'hi'] });
  });

  test('falls back to the single language when there is no list', () => {
    const env = readEnvironment(fake({ timeZone: 'UTC', language: 'en-IN' }));
    assert.deepEqual(env.languages, ['en-IN']);
  });

  test('an empty languages array does not mask navigator.language', () => {
    const env = readEnvironment(
      fake({ timeZone: 'UTC', languages: [], language: 'en-IN' }));
    assert.deepEqual(env.languages, ['en-IN']);
  });

  test('a browser that refuses to resolve a zone still yields a title', () => {
    const hostile = {
      Intl: { DateTimeFormat: () => { throw new Error('nope'); } },
      navigator: { languages: ['en-IN'] },
    };
    const env = readEnvironment(hostile);
    assert.equal(env.timeZone, undefined);
    assert.equal(siteTitle(env), INDIA_TITLE);
  });

  test('no Intl and no navigator is survivable', () => {
    assert.deepEqual(readEnvironment({}), { timeZone: undefined, languages: [] });
    assert.equal(siteTitle(readEnvironment({})), DEFAULT_TITLE);
  });
});
