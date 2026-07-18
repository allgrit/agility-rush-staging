export function shouldUseRiggedDog(locationLike, params) {
  const { hostname = '', pathname = '' } = locationLike || {};
  const isLocal = hostname === '127.0.0.1' || hostname === 'localhost'
    || hostname === '[::1]' || hostname === '::1';
  const isAllgritPages = hostname === 'allgrit.github.io';
  const isProduction = pathname === '/agility-rush' || pathname.startsWith('/agility-rush/');
  const isStaging = pathname === '/agility-rush-staging'
    || pathname.startsWith('/agility-rush-staging/');
  // VK Games (VK Mini App): наш поддомен ИЛИ любой VK-хостинг (CDN *.pages.vk-apps.com
  // и т.п.) — признак запуска из VK это vk_app_id в URL, не хостнейм.
  const isVKHost = hostname === 'agility-rush.tsdpu.org'
    || hostname.endsWith('.pages.vk-apps.com')
    || !!params?.get('vk_app_id');

  return (isAllgritPages && (isProduction || isStaging))
    || isVKHost
    || (isLocal && params?.get('riggedDog') === '1');
}
