/**
 * Controller for the Add Contributor modal.
 */
'use strict';

var $ = require('jquery');
var ko = require('knockout');
var bootbox = require('bootbox');
var Raven = require('raven-js');

var oop = require('./oop');
var $osf = require('./osfHelpers');
var Paginator = require('./paginator');

var NODE_OFFSET = 25;
// Max number of recent/common contributors to show
var MAX_RECENT = 5;

// TODO: Remove dependency on contextVars
var nodeApiUrl = window.contextVars.node.urls.api;
var nodeId = window.contextVars.node.id;

function Contributor(data) {
    $.extend(this, data);
    if (data.n_projects_in_common === 1) {
        this.displayProjectsInCommon = data.n_projects_in_common + ' project in common';
    } else if (data.n_projects_in_common === -1) {
        this.displayProjectsInCommon = 'Yourself';
    } else if (data.n_projects_in_common !== 0) {
        this.displayProjectsInCommon = data.n_projects_in_common + ' projects in common';
    } else {
        this.displayProjectsInCommon = '';
    }
    this.added = false;

}

var AddContributorViewModel = oop.extend(Paginator, {
    constructor: function(title, parentId, parentTitle) {
        this.super.constructor.call(this);
        var self = this;

        self.title = title;
        self.parentId = parentId;
        self.parentTitle = parentTitle;

        //list of permission objects for select.
        self.permissionList = [
            {value: 'read', text: 'Read'},
            {value: 'write', text: 'Read + Write'},
            {value: 'admin', text: 'Administrator'}
        ];

        self.page = ko.observable('whom');
        self.pageTitle = ko.computed(function() {
            return {
                whom: 'Add Contributors',
                which: 'Select Components',
                invite: 'Add Unregistered Contributor'
            }[self.page()];
        });
        self.query = ko.observable();
        self.results = ko.observableArray([]);
        self.contributors = ko.observableArray([]);
        self.selection = ko.observableArray();
        self.notification = ko.observable('');
        self.inviteError = ko.observable('');
        self.totalPages = ko.observable(0);
        self.nodes = ko.observableArray([]);
        self.nodesToChange = ko.observableArray();

        self.getContributors();
        $.getJSON(
            nodeApiUrl + 'get_editable_children/', {},
            function(result) {
                $.each(result.children || [], function(idx, child) {
                    child.margin = NODE_OFFSET + child.indent * NODE_OFFSET + 'px';
                });
                self.nodes(result.children);
            }
        );
        self.foundResults = ko.pureComputed(function() {
            return self.query() && self.results().length;
        });

        self.noResults = ko.pureComputed(function() {
            return self.query() && !self.results().length;
        });

        self.addAllVisible = ko.pureComputed(function() {
            var selected_ids = self.selection().map(function(user){
                return user.id;
            });
            for(var i = 0; i < self.results().length; i++) {
                if(self.contributors().indexOf(self.results()[i].id) === -1 &&
                   selected_ids.indexOf(self.results()[i].id) === -1) {
                    return true;
                }
            }
            return false;
        });

        self.removeAllVisible = ko.pureComputed(function() {
            if(self.selection().length > 0) {
               return true;
            }
            return false;
        });

        self.inviteName = ko.observable();
        self.inviteEmail = ko.observable();

        self.addingSummary = ko.computed(function() {
            var names = $.map(self.selection(), function(result) {
                return result.fullname;
            });
            return names.join(', ');
        });
    },
    selectWhom: function() {
        this.page('whom');
    },
    selectWhich: function() {
        this.page('which');
    },
    gotoInvite: function() {
        var self = this;
        self.inviteName(self.query());
        self.inviteError('');
        self.inviteEmail('');
        self.page('invite');
    },
    goToPage: function(page) {
        this.page(page);
    },
    /**
     * A simple Contributor model that receives data from the
     * contributor search endpoint. Adds an additional displayProjectsinCommon
     * attribute which is the human-readable display of the number of projects the
     * currently logged-in user has in common with the contributor.
     */
    startSearch: function() {
        this.pageToGet(0);
        this.fetchResults();
    },
    fetchResults: function() {
        var self = this;
        self.notification(false);
        if (self.query()) {
            return $.getJSON(
                '/api/v1/user/search/', {
                    query: self.query(),
                    page: self.pageToGet
                },
                function(result) {
                    var contributors = result.users.map(function(userData) {
                        return new Contributor(userData);
                    });
                    for(var i = 0; i < contributors.length; i++) {
                        if (self.contributors().indexOf(contributors[i].id) !== -1) {
                            contributors[i].added = true;
                        } else {
                            contributors[i].added = false;
                        }
                    }
                    self.results(contributors);
                    self.currentPage(result.page);
                    self.numberOfPages(result.pages);
                    self.addNewPaginators();
                }
            );
        } else {
            self.results([]);
            self.currentPage(0);
            self.totalPages(0);
        }
    },
    getContributors: function() {
        var self = this;
        self.notification(false);
        return $.getJSON(
            nodeApiUrl + 'get_contributors/', {},
            function(result) {
                var contributors = result.contributors.map(function(userData) {
                    return userData.id;
                });
                self.contributors(contributors);
            }
        );
    },
    importFromParent: function() {
        var self = this;
        self.notification(false);
        $.getJSON(
            nodeApiUrl + 'get_contributors_from_parent/', {},
            function(result) {
                if (!result.contributors.length) {
                    self.notification({
                        'message': 'All contributors from parent already included.',
                        'level': 'info'
                    });
                }
                self.results(result.contributors);
            }
        );
    },
    addTips: function(elements) {
        elements.forEach(function(element) {
            $(element).find('.contrib-button').tooltip();
        });
    },
    afterRender: function(elm, data) {
        var self = this;
        self.addTips(elm, data);
    },
    makeAfterRender: function() {
        var self = this;
        return function(elm, data) {
            return self.afterRender(elm, data);
        };
    },
    /** Validate the invite form. Returns a string error message or
     *   true if validation succeeds.
     */
    validateInviteForm: function() {
        var self = this;
        // Make sure Full Name is not blank
        if (!self.inviteName().trim().length) {
            return 'Full Name is required.';
        }
        if (self.inviteEmail() && !$osf.isEmail(self.inviteEmail())) {
            return 'Not a valid email address.';
        }
        // Make sure that entered email is not already in selection
        for (var i = 0, contrib; contrib = self.selection()[i]; ++i) {
            if (contrib.email) {
                var contribEmail = contrib.email.toLowerCase().trim();
                if (contribEmail === self.inviteEmail().toLowerCase().trim()) {
                    return self.inviteEmail() + ' is already in queue.';
                }
            }
        }
        return true;
    },
    postInvite: function() {
        var self = this;
        self.inviteError('');
        var validated = self.validateInviteForm();
        if (typeof validated === 'string') {
            self.inviteError(validated);
            return false;
        }
        return self.postInviteRequest(self.inviteName(), self.inviteEmail());
    },
    add: function(data) {
        var self = this;
        data.permission = ko.observable(self.permissionList[1]); //default permission write
        // All manually added contributors are visible
        data.visible = true;
        this.selection.push(data);
        // Hack: Hide and refresh tooltips
        $('.tooltip').hide();
        $('.contrib-button').tooltip();
    },
    remove: function(data) {
        this.selection.splice(
            this.selection.indexOf(data), 1
        );
        // Hack: Hide and refresh tooltips
        $('.tooltip').hide();
        $('.contrib-button').tooltip();
    },
    addAll: function() {
        var self = this;
        var selected_ids = self.selection().map(function(user){
            return user.id;
        });
        $.each(self.results(), function(idx, result) {
            if (selected_ids.indexOf(result.id) === -1 && self.contributors().indexOf(result.id) === -1) {
                self.add(result);
            }
        });
    },
    removeAll: function() {
        var self = this;
        $.each(self.selection(), function(idx, selected) {
            self.remove(selected);
        });
    },
    cantSelectNodes: function() {
        return this.nodesToChange().length === this.nodes().length;
    },
    cantDeselectNodes: function() {
        return this.nodesToChange().length === 0;
    },
    selectNodes: function() {
        this.nodesToChange($osf.mapByProperty(this.nodes(), 'id'));
    },
    deselectNodes: function() {
        this.nodesToChange([]);
    },
    selected: function(data) {
        var self = this;
        for (var idx = 0; idx < self.selection().length; idx++) {
            if (data.id === self.selection()[idx].id) {
                return true;
            }
        }
        return false;
    },
    submit: function() {
        var self = this;
        $osf.block();
        return $osf.postJSON(
            nodeApiUrl + 'contributors/', {
                users: ko.utils.arrayMap(self.selection(), function(user) {
                    var permission = user.permission().value; //removes the value from the object
                    var tUser = JSON.parse(ko.toJSON(user)); //The serialized user minus functions
                    tUser.permission = permission; //shoving the permission value into permission
                    return tUser; //user with simplified permissions
                }),
                node_ids: self.nodesToChange()
            }
        ).done(function() {
            window.location.reload();
        }).fail(function() {
            $('.modal').modal('hide');
            $osf.unblock();
            $osf.growl('Error', 'Add contributor failed.');
        });
    },
    clear: function() {
        var self = this;
        self.page('whom');
        self.query('');
        self.results([]);
        self.selection([]);
        self.nodesToChange([]);
        self.notification(false);
    },
    postInviteRequest: function(fullname, email) {
        var self = this;
        return $osf.postJSON(
            nodeApiUrl + 'invite_contributor/', {
                'fullname': fullname,
                'email': email
            }
        ).done(
            self.onInviteSuccess.bind(self)
        ).fail(
            self.onInviteError.bind(self)
        );
    },
    onInviteSuccess: function(result) {
        var self = this;
        self.query('');
        self.results([]);
        self.page('whom');
        self.add(result.contributor);
    },
    onInviteError: function(xhr) {
        var response = JSON.parse(xhr.responseText);
        // Update error message
        this.inviteError(response.message);
    }
});


////////////////
// Public API //
////////////////

function ContribAdder(selector, nodeTitle, nodeId, parentTitle) {
    var self = this;
    self.selector = selector;
    self.$element = $(selector);
    self.nodeTitle = nodeTitle;
    self.nodeId = nodeId;
    self.parentTitle = parentTitle;
    self.viewModel = new AddContributorViewModel(self.nodeTitle,
        self.nodeId, self.parentTitle);
    self.init();
}

ContribAdder.prototype.init = function() {
    var self = this;
    ko.applyBindings(self.viewModel, self.$element[0]);
    // Clear popovers on dismiss start
    self.$element.on('hide.bs.modal', function() {
        self.$element.find('.popover').popover('hide');
    });
    // Clear user search modal when dismissed; catches dismiss by escape key
    // or cancel button.
    self.$element.on('hidden.bs.modal', function() {
        self.viewModel.clear();
    });
};

module.exports = ContribAdder;
