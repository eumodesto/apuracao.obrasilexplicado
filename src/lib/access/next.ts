/** Only same-site paths are accepted as the post-login destination. */
export function safeNext(value: string | null | undefined) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';
}
