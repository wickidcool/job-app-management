export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'careerpin.app') {
      return env.ASSETS.fetch(request);
    }
    // All non-primary hostnames (www.careerpin.app, careerpin.io, www.careerpin.io) redirect to apex
    return Response.redirect(`https://careerpin.app${url.pathname}${url.search}`, 301);
  },
};
