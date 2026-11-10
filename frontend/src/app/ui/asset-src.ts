import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { AssetStore, isAssetRef } from '../assets';

/**
 * Binds an `<img>` source that may be an `asset:<hash>` reference. The directive
 * resolves the bytes from IndexedDB and updates the element when an asset
 * finishes downloading from CouchDB.
 */
@Directive({ selector: 'img[appAssetSrc]' })
export class AssetSrc {
  readonly appAssetSrc = input.required<string>();

  private readonly image = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly assets = inject(AssetStore);
  private token = 0;

  constructor() {
    effect(() => {
      const src = this.appAssetSrc();
      // Track the revision so images retry after a download or local upload.
      this.assets.revision();
      const token = ++this.token;
      const element = this.image.nativeElement;

      if (!src) {
        element.removeAttribute('src');
        return;
      }

      if (!isAssetRef(src)) {
        element.setAttribute('src', src);
        return;
      }

      void this.assets.resolve(src).then((url) => {
        if (token !== this.token) return;
        if (url) element.setAttribute('src', url);
        else element.removeAttribute('src');
      });
    });
  }
}
