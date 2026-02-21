import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { map } from 'rxjs';

export const responseInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    map(event => {
      if (event instanceof HttpResponse && event.body && typeof event.body === 'object') {
        const body = event.body as any;
        if (body.data !== undefined && !Array.isArray(body)) {
          return event.clone({ body: body.data });
        }
      }
      return event;
    })
  );
};
