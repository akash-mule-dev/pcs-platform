import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpResponse, HTTP_INTERCEPTORS } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
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
  }
}

export const responseInterceptorProvider = {
  provide: HTTP_INTERCEPTORS,
  useClass: ResponseInterceptor,
  multi: true
};
