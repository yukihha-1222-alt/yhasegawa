/* 'cloudflare:email' の EmailMessage の偽物。中身を覚えておくだけ */
export class EmailMessage {
  constructor(from, to, raw) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}
