import ko from 'ko';

import { Notification } from 'Common/Enums';
import { UNUSED_OPTION_VALUE } from 'Common/Consts';
import { defaultOptionsAfterRender } from 'Common/Utils';
import { folderListOptionsBuilder } from 'Common/UtilsUser';

import { FolderUserStore } from 'Stores/User/Folder';

import Remote from 'Remote/User/Fetch';

import { decorateKoCommands } from 'Knoin/Knoin';
import { AbstractViewPopup } from 'Knoin/AbstractViews';

class FolderCreatePopupView extends AbstractViewPopup {
	constructor() {
		super('FolderCreate');

		this.addObservables({
			folderName: '',
			folderNameFocused: false,

			selectedParentValue: UNUSED_OPTION_VALUE
		});

		this.parentFolderSelectList = ko.computed(() =>
			folderListOptionsBuilder(
				[],
				FolderUserStore.folderList(),
				[],
				[['', '']],
				FolderUserStore.namespace
					? item => FolderUserStore.namespace !== item.fullNameRaw.substr(0, FolderUserStore.namespace.length)
					: null,
				oItem =>
					oItem ? (oItem.isSystemFolder() ? oItem.name() + ' ' + oItem.manageFolderSystemName() : oItem.name()) : ''
			)
		);

		this.defaultOptionsAfterRender = defaultOptionsAfterRender;

		decorateKoCommands(this, {
			createFolderCommand: self => self.simpleFolderNameValidation(self.folderName())
		});
	}

	createFolderCommand() {
		let parentFolderName = this.selectedParentValue();
		if (!parentFolderName && 1 < FolderUserStore.namespace.length) {
			parentFolderName = FolderUserStore.namespace.substr(0, FolderUserStore.namespace.length - 1);
		}

		rl.app.foldersPromisesActionHelper(
			Remote.folderCreate(this.folderName(), parentFolderName),
			Notification.CantCreateFolder
		);

		this.cancelCommand();
	}

	simpleFolderNameValidation(sName) {
		return /^[^\\/]+$/g.test(sName.trim());
	}

	clearPopup() {
		this.folderName('');
		this.selectedParentValue('');
		this.folderNameFocused(false);
	}

	onShow() {
		this.clearPopup();
	}

	onShowWithDelay() {
		this.folderNameFocused(true);
	}
}

export { FolderCreatePopupView, FolderCreatePopupView as default };
